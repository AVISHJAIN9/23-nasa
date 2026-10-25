"""
AstroCare Physiological Digital-Twin Simulator CLI.
Executes scripted scenarios and streams telemetry to the AstroCare Ingest REST API.

References & Physiological Source Standards:
- NASA-STD-3001 Vol 1 & 2: Space Flight Human-System Standard.
- Tanaka et al. (2001) Age-predicted maximal heart rate revisited. JACC.
- Law et al. (2014) Carbon dioxide levels and reported headaches on the ISS. JOEM.
- Hargens & Richardson (2009) Cardiovascular adaptations, fluid shifts, and countermeasures.
- Cucinotta et al. (2013) Space radiation risks to the central nervous system.
"""

import sys
import time
import json
import argparse
from pathlib import Path
from typing import Optional, List, Dict, Any

from .models.astronaut import AstronautProfile
from .engine.scenario import load_scenario, Scenario
from .engine.generator import TelemetryGenerator
from .client.api_client import TelemetryApiClient, IngestionResult


def parse_args(args: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="astrocare-sim",
        description="AstroCare Space-Medicine Physiological Digital-Twin Simulator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Available Scenarios:
  normal_day                      Nominal 24-hour diurnal cycle with exercise & sleep
  heavy_exercise                  HIIT interval workout on CEVIS cycle ergometer
  co2_rise                        Cabin hypercapnia and ventilatory compensation
  sensor_dropout                  Pulse-ox, chest band, and cuff lead-off dropouts
  spike_artifacts                 Rate-of-change motion & static spikes
  cardiac_event_during_blackout   Acute tachycardia during comms blackout
  slow_degradation_over_days      Multi-sol Mars transit deconditioning & radiation
        """,
    )

    parser.add_argument(
        "--scenario",
        "-s",
        type=str,
        default="normal_day",
        help="Scenario name or YAML file path (default: normal_day)",
    )
    parser.add_argument(
        "--url",
        type=str,
        default="http://localhost:4000",
        help="AstroCare backend base URL (default: http://localhost:4000)",
    )
    parser.add_argument(
        "--api-key",
        type=str,
        default="dev_insecure_ingest_api_key_min_32_characters!",
        help="Ingestion API key for X-Ingest-Key authentication",
    )
    parser.add_argument(
        "--crew-id",
        type=str,
        default="660e8400e29b41d4a7164466",
        help="24-character hexadecimal MongoDB ObjectId of target astronaut",
    )
    parser.add_argument(
        "--astronaut",
        type=str,
        choices=["mercer", "chen"],
        default="mercer",
        help="Preset astronaut profile (default: mercer)",
    )
    parser.add_argument(
        "--rate",
        type=float,
        default=None,
        help="Sampling rate override in Hz (e.g. 1.0 or 0.5)",
    )
    parser.add_argument(
        "--speed",
        type=float,
        default=0.0,
        help="Time acceleration multiplier (0.0 = full speed unthrottled, 1.0 = real-time, 10.0 = 10x)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="PRNG seed for deterministic simulation output (default: 42)",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=35,
        help="Number of readings per HTTP batch (default: 35, max: 500)",
    )
    parser.add_argument(
        "--duration",
        type=float,
        default=None,
        help="Simulation duration override in seconds (default: scenario duration)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Simulate and print metrics without transmitting HTTP requests",
    )
    parser.add_argument(
        "--output",
        "-o",
        type=str,
        default=None,
        help="Save generated telemetry readings to a local JSON file",
    )
    parser.add_argument(
        "--quiet",
        "-q",
        action="store_true",
        help="Suppress per-batch output messages",
    )

    return parser.parse_args(args)


def run_simulation(args: argparse.Namespace) -> int:
    """Runs the simulation according to CLI arguments."""
    # 1. Load scenario
    try:
        scenario = load_scenario(args.scenario)
    except FileNotFoundError as ex:
        print(f"[Error] {ex}", file=sys.stderr)
        return 1

    if args.rate and args.rate > 0:
        scenario.sampling_rate_hz = args.rate

    duration_s = args.duration if args.duration is not None else scenario.duration_seconds

    # 2. Configure astronaut
    if args.astronaut == "chen":
        profile = AstronautProfile.create_chen(crew_id=args.crew_id)
    else:
        profile = AstronautProfile.create_mercer(crew_id=args.crew_id)

    # 3. Setup generator & API client
    generator = TelemetryGenerator(
        scenario=scenario,
        astronaut=profile,
        seed=args.seed,
    )

    client = TelemetryApiClient(
        base_url=args.url,
        api_key=args.api_key,
    )

    if not args.quiet:
        print("=" * 70)
        print(" ASTROCARE PHYSIOLOGICAL DIGITAL-TWIN SIMULATOR (Phase 2)")
        print("=" * 70)
        print(f" Scenario:       {scenario.name} ({duration_s:.0f}s)")
        print(f" Description:    {scenario.description}")
        print(f" Astronaut:      {profile.callsign} ({profile.sex}, {profile.age}yo, crew_id={profile.crew_id})")
        print(f" Sampling Rate:  {scenario.sampling_rate_hz} Hz ({7 * scenario.sampling_rate_hz:.1f} readings/s)")
        print(f" Batch Size:     {args.batch_size} readings")
        print(f" Seed:           {args.seed} (Deterministic)")
        print(f" Mode:           {'DRY RUN (no network)' if args.dry_run else f'HTTP -> {args.url}/v1/telemetry'}")
        print("=" * 70)

    total_readings = 0
    total_accepted = 0
    total_batches = 0
    recorded_telemetry: List[Dict[str, Any]] = []

    start_wall_time = time.time()
    dt_step = 1.0 / scenario.sampling_rate_hz

    # Stream batches
    for batch in generator.stream_batches(batch_size=args.batch_size, max_duration_s=duration_s):
        total_batches += 1
        total_readings += len(batch)

        if args.output:
            recorded_telemetry.extend(batch)

        batch_id = f"sim-{scenario.name}-{args.seed}-b{total_batches:05d}"

        if args.dry_run:
            sample = batch[0] if batch else {}
            first_vitals = {r["metric"]: r["value"] for r in batch[:7]}
            if not args.quiet:
                print(f" [Batch {total_batches:04d}] {sample.get('timestamp', '')} | {first_vitals}")
        else:
            result = client.post_batch(readings=batch, batch_id=batch_id)
            if result.status_code == 200:
                total_accepted += result.accepted
                if not args.quiet:
                    quality_info = result.quality.get("by_flag", {})
                    flagged = result.quality.get("flagged", 0)
                    replayed_str = " (replayed)" if result.is_replayed else ""
                    print(
                        f" [Batch {total_batches:04d}] HTTP 200 OK | "
                        f"Accepted: {result.accepted}/{result.received}{replayed_str} | "
                        f"Flagged: {flagged} {quality_info}"
                    )
            else:
                print(f" [Batch {total_batches:04d}] {result.error_message}", file=sys.stderr)

        # Handle time compression / rate throttling
        if args.speed > 0:
            simulated_batch_duration = (len(batch) / 7.0) * dt_step
            sleep_duration = simulated_batch_duration / args.speed
            if sleep_duration > 0.001:
                time.sleep(sleep_duration)

    elapsed_wall = time.time() - start_wall_time
    sim_throughput = total_readings / max(0.001, elapsed_wall)

    if args.output:
        out_path = Path(args.output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(recorded_telemetry, f, indent=2)
        if not args.quiet:
            print(f"\nSaved {len(recorded_telemetry)} readings to {args.output}")

    if not args.quiet:
        print("-" * 70)
        print(f" Simulation Finished:")
        print(f" Total Batches:     {total_batches}")
        print(f" Total Readings:    {total_readings}")
        if not args.dry_run:
            print(f" Ingest Accepted:   {total_accepted} / {total_readings}")
        print(f" Elapsed Wall Time: {elapsed_wall:.2f}s (Throughput: {sim_throughput:.1f} readings/s)")
        print("=" * 70)

    return 0


def main() -> None:
    sys.exit(run_simulation(parse_args()))


if __name__ == "__main__":
    main()
