#!/usr/bin/env python3
"""Petit CLI pour piloter des ampoules TP-Link Tapo sans Home Assistant."""

from __future__ import annotations

import argparse
import asyncio
import ipaddress
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Iterable

from kasa import Credentials, Discover, Module
from kasa.exceptions import AuthenticationError, KasaException, UnsupportedDeviceError
from kasa.interfaces.light import LightState


ENV_FILE = Path(__file__).with_name(".env")
DEFAULT_SCAN_TIMEOUT = 3
DEFAULT_PROBE_RETRIES = 0


def load_dotenv(path: Path = ENV_FILE) -> None:
    if not path.exists():
        return

    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def credentials() -> Credentials:
    load_dotenv()
    email = os.getenv("TAPO_EMAIL")
    password = os.getenv("TAPO_PASSWORD")
    if not email or not password:
        raise SystemExit(
            "Identifiants manquants. Copie .env.example vers .env puis remplis "
            "TAPO_EMAIL et TAPO_PASSWORD."
        )
    return Credentials(email, password)


def is_ip_address(value: str) -> bool:
    try:
        ipaddress.ip_address(value)
    except ValueError:
        return False
    return True


def unsupported_message(ip: str, exc: Exception) -> str:
    if "TPAP" in str(exc):
        return (
            f"{ip} | appareil detecte mais protocole TPAP non supporte | "
            "active la compatibilite tierce dans l'app Tapo si disponible"
        )
    return f"{ip} | appareil non supporte | {exc}"


def arp_ips() -> list[str]:
    try:
        proc = subprocess.run(
            ["arp", "-an"],
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError:
        return []

    ips: list[str] = []
    for line in proc.stdout.splitlines():
        if "incomplete" in line:
            continue
        match = re.search(r"\((\d+\.\d+\.\d+\.\d+)\)", line)
        if match:
            ips.append(match.group(1))
    return ips


def known_ips() -> list[str]:
    raw = os.getenv("TAPO_KNOWN_IPS", "")
    configured = [ip.strip() for ip in raw.split(",") if ip.strip()]
    return configured


def known_aliases() -> dict[str, str]:
    raw = os.getenv("TAPO_KNOWN_ALIASES", "")
    aliases = {}
    for item in raw.split(","):
        if not item.strip() or "=" not in item:
            continue
        ip, alias = item.split("=", 1)
        ip = ip.strip()
        alias = alias.strip()
        if is_ip_address(ip) and alias:
            aliases[ip] = alias
    return aliases


def unique_ips(values: Iterable[str]) -> list[str]:
    seen = set()
    result = []
    for value in values:
        if not is_ip_address(value) or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def device_to_dict(ip: str, dev) -> dict:
    light = light_module(dev)
    data = {
        "ip": ip,
        "alias": dev.alias or "",
        "model": dev.model or "",
        "is_on": bool(dev.is_on),
        "controllable": True,
        "status": "online",
        "features": {
            "brightness": bool(light and light.has_feature("brightness")),
            "color_temp": bool(light and light.has_feature("color_temp")),
            "hsv": bool(light and light.has_feature("hsv")),
        },
        "brightness": None,
        "color_temp": None,
        "hsv": None,
        "error": None,
    }
    if light:
        if data["features"]["brightness"]:
            data["brightness"] = light.brightness
        if data["features"]["color_temp"]:
            data["color_temp"] = light.color_temp
        if data["features"]["hsv"]:
            hue, saturation, value = light.hsv
            data["hsv"] = {"hue": hue, "saturation": saturation, "value": value}
    return data


def unsupported_to_dict(ip: str, exc: Exception) -> dict:
    is_tpap = "TPAP" in str(exc)
    return {
        "ip": ip,
        "alias": "",
        "model": "",
        "is_on": None,
        "controllable": False,
        "status": "unsupported_tpap" if is_tpap else "unsupported",
        "features": {"brightness": False, "color_temp": False, "hsv": False},
        "brightness": None,
        "color_temp": None,
        "hsv": None,
        "error": "Protocole TPAP non supporte" if is_tpap else str(exc),
    }


def offline_to_dict(ip: str) -> dict:
    return {
        "ip": ip,
        "alias": known_aliases().get(ip, ""),
        "model": "",
        "is_on": None,
        "controllable": False,
        "status": "offline",
        "features": {"brightness": False, "color_temp": False, "hsv": False},
        "brightness": None,
        "color_temp": None,
        "hsv": None,
        "error": "Hors ligne ou non joignable",
    }


async def probe_ip(ip: str, timeout: int) -> dict | None:
    try:
        dev = await discover_single_device(ip, timeout)
    except UnsupportedDeviceError as exc:
        return unsupported_to_dict(ip, exc)
    except Exception:
        return None

    try:
        try:
            await update_device(dev)
        except AuthenticationError:
            return {
                "ip": ip,
                "alias": "",
                "model": "",
                "is_on": None,
                "controllable": False,
                "status": "auth_failed",
                "features": {"brightness": False, "color_temp": False, "hsv": False},
                "brightness": None,
                "color_temp": None,
                "hsv": None,
                "error": "Authentification refusee",
            }
        except KasaException as exc:
            return {
                "ip": ip,
                "alias": "",
                "model": "",
                "is_on": None,
                "controllable": False,
                "status": "error",
                "features": {"brightness": False, "color_temp": False, "hsv": False},
                "brightness": None,
                "color_temp": None,
                "hsv": None,
                "error": str(exc),
            }
        return device_to_dict(ip, dev)
    finally:
        await disconnect_device(dev)


async def probe_known_ip(ip: str, timeout: int) -> dict:
    try:
        result = await probe_ip(ip, timeout)
    except Exception:
        result = None
    return result or offline_to_dict(ip)


async def scan_known_devices(timeout: int) -> list[dict]:
    known = unique_ips(known_ips())
    results = await asyncio.gather(
        *(probe_known_ip(ip, timeout) for ip in known)
    )
    results.sort(key=lambda item: tuple(int(part) for part in item["ip"].split(".")))
    return results


async def scan_devices(timeout: int) -> list[dict]:
    known = unique_ips(known_ips())
    first_candidates = unique_ips([*known, *arp_ips()])
    discovery_task = asyncio.create_task(discover_devices(timeout))
    probe_tasks = {
        ip: asyncio.create_task(probe_ip(ip, DEFAULT_SCAN_TIMEOUT))
        for ip in first_candidates
    }

    discovered = await discovery_task
    for ip in discovered.keys():
        if ip not in probe_tasks:
            probe_tasks[ip] = asyncio.create_task(probe_ip(ip, DEFAULT_SCAN_TIMEOUT))

    results = await asyncio.gather(*probe_tasks.values())
    devices = [item for item in results if item]
    found_ips = {item["ip"] for item in devices}
    devices.extend(offline_to_dict(ip) for ip in known if ip not in found_ips)
    devices.sort(key=lambda item: tuple(int(part) for part in item["ip"].split(".")))
    return devices


async def discover_devices(timeout: int):
    return await Discover.discover(
        credentials=credentials(),
        discovery_timeout=timeout,
    )


async def tcp_reachable(ip: str, timeout: float = 0.35) -> bool:
    try:
        _, writer = await asyncio.wait_for(
            asyncio.open_connection(ip, 80),
            timeout=timeout,
        )
    except Exception:
        return False

    writer.close()
    try:
        await writer.wait_closed()
    except Exception:
        pass
    return True


async def discover_single_device(
    ip: str,
    timeout: int = DEFAULT_SCAN_TIMEOUT,
    retries: int = DEFAULT_PROBE_RETRIES,
    preflight: bool = False,
):
    if preflight and not await tcp_reachable(ip):
        raise TimeoutError(f"{ip} ne repond pas sur le reseau local")

    last_error = None
    for attempt in range(retries + 1):
        try:
            return await Discover.discover_single(
                ip,
                credentials=credentials(),
                timeout=timeout,
            )
        except UnsupportedDeviceError:
            raise
        except Exception as exc:
            last_error = exc
            if attempt < retries:
                await asyncio.sleep(0.35)
    raise last_error


async def discover_control_devices(timeout: int) -> dict[str, object]:
    devices = dict(await discover_devices(timeout))
    candidates = unique_ips([*known_ips(), *arp_ips()])
    candidate_timeout = min(timeout, DEFAULT_SCAN_TIMEOUT)

    async def add_single(ip: str) -> tuple[str, object] | None:
        if ip in devices:
            return None
        try:
            dev = await discover_single_device(ip, candidate_timeout, preflight=True)
        except Exception:
            return None
        return ip, dev

    results = await asyncio.gather(*(add_single(ip) for ip in candidates))
    for result in results:
        if result:
            ip, dev = result
            devices[ip] = dev
    return devices


async def update_device(dev) -> None:
    await dev.update()


async def safe_update_device(ip: str, dev) -> bool:
    try:
        await update_device(dev)
    except AuthenticationError:
        print(
            f"{ip} | authentification refusee | verifie TAPO_EMAIL/TAPO_PASSWORD "
            "dans .env",
            file=sys.stderr,
        )
        return False
    except KasaException as exc:
        print(f"{ip} | erreur kasa | {exc}", file=sys.stderr)
        return False
    return True


async def disconnect_device(dev) -> None:
    try:
        await dev.disconnect()
    except Exception:
        pass


def light_module(dev):
    return dev.modules.get(Module.Light)


def supports_light(dev) -> bool:
    return light_module(dev) is not None


def predicted_device_to_dict(ip: str, dev, action: str, values: Iterable[int]) -> dict:
    data = device_to_dict(ip, dev)
    values = list(values)

    if action == "on":
        data["is_on"] = True
    elif action == "off":
        data["is_on"] = False
    elif action == "toggle":
        data["is_on"] = not bool(data["is_on"])
    elif action == "brightness":
        data["is_on"] = True
        data["brightness"] = values[0]
    elif action == "temp":
        data["is_on"] = True
        data["color_temp"] = values[0]
        data["hsv"] = None
        if len(values) > 1:
            data["brightness"] = values[1]
    elif action == "color":
        data["is_on"] = True
        data["color_temp"] = 0
        data["hsv"] = {
            "hue": values[0],
            "saturation": values[1],
            "value": values[2] if len(values) > 2 else data["brightness"],
        }
        if len(values) > 2:
            data["brightness"] = values[2]

    return data


def format_device(ip: str, dev) -> str:
    light = light_module(dev)
    parts = [
        ip,
        dev.alias or "(sans nom)",
        dev.model or "modele inconnu",
        "on" if dev.is_on else "off",
    ]
    if light:
        if light.has_feature("brightness"):
            parts.append(f"{light.brightness}%")
        if light.has_feature("color_temp"):
            parts.append(f"{light.color_temp}K")
        if light.has_feature("hsv"):
            hue, saturation, value = light.hsv
            parts.append(f"hsv={hue},{saturation},{value}")
    return " | ".join(parts)


def clamp(value: int, minimum: int, maximum: int, name: str) -> int:
    if not minimum <= value <= maximum:
        raise SystemExit(f"{name} doit etre entre {minimum} et {maximum}.")
    return value


def matching_devices(devices: dict[str, object], target: str) -> list[tuple[str, object]]:
    if target.lower() == "all":
        return [(ip, dev) for ip, dev in devices.items() if supports_light(dev)]

    needle = target.casefold()
    matches: list[tuple[str, object]] = []
    for ip, dev in devices.items():
        alias = (dev.alias or "").casefold()
        if ip == target or needle in alias:
            matches.append((ip, dev))
    return matches


async def get_targets(target: str, timeout: int) -> list[tuple[str, object]]:
    if "," in target:
        targets = unique_ips(ip.strip() for ip in target.split(","))
        if not targets:
            raise SystemExit(f"Aucune ampoule trouvee pour la cible: {target}")

        async def get_single(ip: str) -> tuple[str, object] | None:
            try:
                dev = await discover_single_device(ip, timeout, preflight=True)
            except Exception:
                return None
            if await safe_update_device(ip, dev):
                return ip, dev
            await disconnect_device(dev)
            return None

        results = await asyncio.gather(*(get_single(ip) for ip in targets))
        matches = [result for result in results if result]
        if not matches:
            raise SystemExit(f"Aucune ampoule joignable pour la cible: {target}")
        return matches

    if is_ip_address(target):
        try:
            dev = await discover_single_device(target, timeout, preflight=True)
        except UnsupportedDeviceError as exc:
            raise SystemExit(unsupported_message(target, exc)) from exc
        except KasaException as exc:
            raise SystemExit(f"{target} | appareil introuvable ou indisponible | {exc}") from exc
        except Exception as exc:
            raise SystemExit(f"{target} | appareil introuvable ou indisponible | {exc}") from exc
        if not await safe_update_device(target, dev):
            await disconnect_device(dev)
            raise SystemExit(1)
        return [(target, dev)]

    devices = await discover_control_devices(timeout)
    async def prepare_device(ip: str, dev) -> tuple[str, object] | None:
        if await safe_update_device(ip, dev):
            return ip, dev
        await disconnect_device(dev)
        return None

    prepared = await asyncio.gather(
        *(prepare_device(ip, dev) for ip, dev in devices.items())
    )
    usable_devices = {
        ip: dev
        for result in prepared
        if result
        for ip, dev in [result]
    }

    matches = matching_devices(usable_devices, target)
    if not matches:
        for dev in usable_devices.values():
            await disconnect_device(dev)
        raise SystemExit(f"Aucune ampoule trouvee pour la cible: {target}")

    match_ids = {id(dev) for _, dev in matches}
    for dev in usable_devices.values():
        if id(dev) not in match_ids:
            await disconnect_device(dev)
    return matches


async def cmd_discover(args) -> None:
    if args.json:
        scanner = scan_known_devices if args.known_only else scan_devices
        print(json.dumps({"devices": await scanner(args.timeout)}, ensure_ascii=False))
        return

    devices = {
        item["ip"]: item
        for item in await scan_known_devices(args.timeout)
    } if args.known_only else await discover_devices(args.timeout)
    if not devices:
        print("Aucun appareil trouve. Verifie que tu es sur le meme Wi-Fi.")
        return

    if args.known_only:
        for item in devices.values():
            print(" | ".join([
                item["ip"],
                item["alias"] or "(sans nom)",
                item["model"] or "modele inconnu",
                item["status"],
            ]))
    else:
        for ip, dev in devices.items():
            if await safe_update_device(ip, dev):
                print(format_device(ip, dev))
            await disconnect_device(dev)


async def apply_action(
    dev,
    action: str,
    values: Iterable[int],
    transition: int | None = None,
) -> None:
    light = light_module(dev)

    if action == "on":
        await dev.turn_on()
    elif action == "off":
        await dev.turn_off()
    elif action == "toggle":
        if dev.is_on:
            await dev.turn_off()
        else:
            await dev.turn_on()
    elif action == "brightness":
        if not light or not light.has_feature("brightness"):
            raise SystemExit(f"{dev.alias} ne supporte pas le reglage de luminosite.")
        (brightness,) = values
        await light.set_state(LightState(
            brightness=clamp(brightness, 1, 100, "brightness"),
            transition=transition,
        ))
    elif action == "temp":
        if not light or not light.has_feature("color_temp"):
            raise SystemExit(f"{dev.alias} ne supporte pas la temperature de blanc.")
        temp, *rest = values
        brightness = rest[0] if rest else None
        await light.set_state(LightState(
            color_temp=temp,
            brightness=clamp(brightness, 1, 100, "brightness") if brightness else None,
            transition=transition,
        ))
    elif action == "color":
        if not light or not light.has_feature("hsv"):
            raise SystemExit(f"{dev.alias} ne supporte pas la couleur HSV.")
        hue, saturation, *rest = values
        value = rest[0] if rest else None
        await light.set_state(LightState(
            hue=clamp(hue, 0, 360, "hue"),
            saturation=clamp(saturation, 0, 100, "saturation"),
            brightness=clamp(value, 1, 100, "value") if value is not None else None,
            color_temp=0,
            transition=transition,
        ))
    else:
        raise SystemExit(f"Action inconnue: {action}")


async def cmd_control(args) -> None:
    targets = await get_targets(args.target, args.timeout)

    async def control_one(ip: str, dev) -> dict | str:
        try:
            await apply_action(dev, args.action, args.values, args.transition)
            if args.json:
                if args.no_refresh:
                    return predicted_device_to_dict(ip, dev, args.action, args.values)
                await update_device(dev)
                return device_to_dict(ip, dev)
            if not args.no_refresh:
                await update_device(dev)
            return format_device(ip, dev)
        finally:
            await disconnect_device(dev)

    results = await asyncio.gather(
        *(control_one(ip, dev) for ip, dev in targets)
    )

    if args.json:
        print(json.dumps({"devices": results}, ensure_ascii=False))
    else:
        for line in results:
            print(line)


def parse_args(argv: list[str]) -> argparse.Namespace:
    if argv and argv[0] not in {"discover", "control", "-h", "--help"} and not argv[0].startswith("--"):
        argv = ["control", *argv]

    parser = argparse.ArgumentParser(
        description="Controle simple des ampoules TP-Link Tapo sur le reseau local.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="sortie JSON pour l'interface web",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=5,
        help="temps de recherche des appareils en secondes (defaut: 5)",
    )

    subparsers = parser.add_subparsers(dest="command")

    discover = subparsers.add_parser("discover", help="lister les appareils detectes")
    discover.add_argument(
        "--known-only",
        action="store_true",
        help="sonder uniquement les IP connues pour accelerer l'interface web",
    )
    discover.set_defaults(func=cmd_discover)

    control = subparsers.add_parser("control", help="piloter une ampoule")
    control.add_argument(
        "--no-refresh",
        action="store_true",
        help="ne pas relire l'etat apres la commande pour accelerer l'UI",
    )
    control.add_argument(
        "--transition",
        type=int,
        default=None,
        help="duree de transition en millisecondes pour luminosite/couleur/blanc",
    )
    control.add_argument(
        "target",
        help='IP, morceau du nom de l ampoule, ou "all" pour toutes les ampoules',
    )
    control.add_argument(
        "action",
        choices=["on", "off", "toggle", "brightness", "temp", "color"],
        help="action a appliquer",
    )
    control.add_argument(
        "values",
        nargs="*",
        type=int,
        help="valeurs: brightness %%, temp K [brightness %%], color hue saturation [value %%]",
    )
    control.set_defaults(func=cmd_control)

    args = parser.parse_args(argv)
    if not args.command:
        parser.print_help()
        raise SystemExit(0)

    expected_counts = {
        "on": (0,),
        "off": (0,),
        "toggle": (0,),
        "brightness": (1,),
        "temp": (1, 2),
        "color": (2, 3),
    }
    if args.command == "control":
        allowed = expected_counts[args.action]
        if len(args.values) not in allowed:
            parser.error(
                f"l action {args.action} attend {allowed} valeur(s), "
                f"recu: {len(args.values)}"
            )

    return args


async def main(argv: list[str]) -> None:
    args = parse_args(argv)
    await args.func(args)


if __name__ == "__main__":
    try:
        asyncio.run(main(sys.argv[1:]))
    except KeyboardInterrupt:
        raise SystemExit(130)
