# F2: Comms Delay Emulator & DTN Buffer

## Overview
Simulates interplanetary one-way light-time (OWLT) communication delays and provides persistent outbox queueing across orbital blackouts.

## Mission Profiles
- **ISS**: $0$ seconds (Near-Earth real-time).
- **Moon**: $\approx 1.3$ seconds.
- **Mars**: $180$ to $1320$ seconds ($3$ to $22$ minutes).

## Say It Out Loud
> "To replicate real mission physics, I engineered the Comms Delay Emulator in `linkEmulator.ts`. For ISS missions, latency is zero; for Lunar Artemis missions, it adds 1.3 seconds; and for Mars, it dynamically models 3 to 22 minutes of light-time delay based on planetary orbital alignment."
