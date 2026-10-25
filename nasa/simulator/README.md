# AstroCare Physiological Digital-Twin Simulator (Phase 2)

[![Python](https://img.shields.io/badge/Python-3.11%2B-blue.svg)](https://www.python.org/)
[![Pytest](https://img.shields.io/badge/Pytest-Passing-green.svg)](https://docs.pytest.org/)
[![NASA-STD-3001](https://img.shields.io/badge/Standard-NASA--STD--3001-orange.svg)](https://www.nasa.gov/)

> High-fidelity astronaut physiological digital-twin simulator designed for space-medicine tele-monitoring, clinical triage validation, and delay-tolerant deep-space decision support.

---

## 1. Physiological Model Architecture

The simulator models individual astronaut physiology by composing six scientifically grounded sub-models into a continuous time-series generator:

```
+-----------------------------------------------------------------------------------+
|                            Astronaut Profile Baseline                             |
|          (Resting HR, SpO2, SBP, DBP, Core Temp, Resp Rate, HRV, VO2max)          |
+-----------------------------------------+-----------------------------------------+
                                          |
    +-------------------+-----------------+-----------------+-------------------+
    |                   |                                   |                   |
    v                   v                                   v                   v
+--------------+  +---------------+                   +---------------+  +--------------+
|  Circadian   |  |   Exercise    |                   | Microgravity  |  | Environment  |
| Rhythm (24h) |  |   Kinetics    |                   | Decondition.  |  | (CO2 Hazard) |
+-------+------+  +-------+-------+                   +-------+-------+  +-------+------+
        |                 |                                   |                  |
        +--------+--------+-----------------+-----------------+------------------+
                 |                          |
                 v                          v
          +--------------+          +----------------+
          |  Radiation   |          |  Sensor Noise  |
          |  Dose (GCR)  |          |  & Artifacts   |
          +-------+------+          +-------+--------+
                  |                         |
                  +------------+------------+
                               |
                               v
               +-------------------------------+
               |    Composite Digital Twin     |
               | (Coupled Physiological Vitals)|
               +---------------+---------------+
                               |
                               v
               +-------------------------------+
               | POST /v1/telemetry (API Batch)|
               +-------------------------------+
```

---

## 2. Biological Sub-Models & Clinical References

### A. Circadian Rhythm Engine (`CircadianModel`)
- **Biological Basis**: Endogenous 24-hour diurnal oscillation driven by the suprachiasmatic nucleus (SCN).
- **Core Dynamics**:
  - Core body temperature nadir at ~04:30 UTC ($\Delta T \approx -0.38$ °C); peak at ~16:30 UTC ($\Delta T \approx +0.38$ °C).
  - Resting heart rate nadir at ~04:00 UTC ($\Delta HR \approx -7.0$ bpm); peak at ~16:00 UTC ($\Delta HR \approx +7.0$ bpm).
  - Nocturnal blood pressure dipping: ~10-15% reduction in systolic and diastolic pressure during the sleep window (22:30 to 06:30).
  - Autonomic vagal tone elevation during slow-wave sleep ($\Delta \text{HRV RMSSD} \approx +14$ ms).
- **Literature References**:
  - *Czeisler et al. (1999)* Stability, precision, and near-24-hour period of the human circadian pacemaker. *Science*.
  - *Dijk et al. (2001)* Sleep and circadian rhythms in spaceflight. *Brain Res Rev*.
  - *NASA-STD-3001 Vol 1*, Section 4.5 (Circadian Entrainment Standards).

### B. Exercise Response & Cardiorespiratory Kinetics (`ExerciseModel`)
- **Biological Basis**: Dynamic transition between rest and aerobic/resistance workloads on spacecraft exercise countermeasures (CEVIS cycle ergometer, T2 treadmill, ARED).
- **Core Dynamics**:
  - First-order differential response kinetics:
    $$\tau_{on} \frac{d(\Delta HR)}{dt} + \Delta HR = K_{HR} \cdot W, \quad \tau_{on} \approx 30\text{s}$$
  - Recovery decay off-transient following cessation of exercise ($\tau_{off} \approx 65\text{s}$).
  - Maximal heart rate ceiling based on Tanaka formula: $HR_{max} = 208 - 0.7 \times \text{age}$.
  - Systolic BP increases with workload ($+20$ to $+60$ mmHg), while diastolic BP drops slightly ($-4$ to $-8$ mmHg) due to metabolic vasodilation in active skeletal muscle.
  - Minute ventilation and respiration rate climb steeply ($+18$ to $+28$ breaths/min).
  - Delayed metabolic thermal accumulation ($\tau_{temp} \approx 480\text{s}$) elevating core temp up to $+0.85$ °C.
- **Literature References**:
  - *Whipp & Ward (1990)* Physiological determinants of pulmonary gas exchange kinetics during exercise. *Med Sci Sports Exerc*.
  - *Moore et al. (2014)* Cardiovascular conditioning during spaceflight. *NASA TM-2014-217384*.
  - *Tanaka et al. (2001)* Age-predicted maximal heart rate revisited. *J Am Coll Cardiol*.

### C. Microgravity Cephalad Fluid Shift & Cardiovascular Deconditioning (`MicrogravityModel`)
- **Biological Basis**: Loss of the 1G hydrostatic pressure column in microgravity causes acute cranial fluid shifts followed by neurohormonal diuresis and progressive cardiac remodeling.
- **Core Dynamics**:
  - **Phase 1: Cephalad Fluid Shift (Days 0-4)**: ~1.8 liters of interstitial fluid relocates from the lower extremities to the thoracic and cephalic regions. Transient increase in central venous pressure and systolic blood pressure (+4 to +6 mmHg), settling within 5 days as plasma volume contracts by 10-15%.
  - **Phase 2: Chronic Deconditioning (Days 5-180+)**: Decreased left ventricular stroke volume (~10%). Resting heart rate elevates asymptotically ($\Delta HR \approx +9.0 \cdot (1 - e^{-d / 24})$ bpm) to preserve resting cardiac output ($CO = HR \times SV$). Attenuated baroreflex reserve.
- **Literature References**:
  - *Hargens & Richardson (2009)* Cardiovascular adaptations, fluid shifts, and countermeasures related to space flight. *Respir Physiol Neurobiol*.
  - *Norsk et al. (2015)* Fluid shifts, vasodilatation and ambulatory blood pressure in space. *J Physiol*.
  - *Perhonen et al. (2001)* Cardiac atrophy after bed rest and spaceflight. *J Appl Physiol*.

### D. Cabin Atmospheric Environmental & Hypercapnia Engine (`EnvironmentModel`)
- **Biological Basis**: Spacecraft cabin CO2 pocketing or ECLSS scrubber degradation causing arterial hypercapnia and respiratory acidosis.
- **Core Dynamics**:
  - Spacecraft nominal limit: $< 3,500$ ppm (~2.7 mmHg).
  - Medullary central chemoreceptors trigger ventilatory drive: respiration rate rises linearly with CO2 excess ($\Delta RR \approx +2.8$ breaths/min per 1,000 ppm excess).
  - Sympathetic arousal induces mild tachycardia and hypertension ($\Delta HR \approx +2.2$ bpm / 1k ppm; $\Delta SBP \approx +3.1$ mmHg / 1k ppm).
  - Extreme hypercapnia (> 10,000 ppm) dilutes alveolar O2, causing secondary desaturation.
- **Literature References**:
  - *Law et al. (2014)* Relationship between carbon dioxide levels and reported headaches on the International Space Station. *J Occup Environ Med*.
  - *NASA-STD-3001 Vol 2*, Section 6.2 (Atmospheric Quality and Composition Limits).

### E. Cumulative Space Radiation Tracker (`RadiationModel`)
- **Biological Basis**: Continuous exposure to Galactic Cosmic Rays (GCR) and sporadic Solar Particle Events (SPE).
- **Core Dynamics**:
  - Background interplanetary rate: ~1.5 to 1.8 mSv / day.
  - Cumulative mission dose tracking against NASA lifetime permissible limits (600 mSv career limit).
  - Acute solar particle alert triggers (> 100 mSv/day dose rate).
- **Literature References**:
  - *Cucinotta et al. (2013)* Space radiation risks to the central nervous system. *Life Sci Space Res*.
  - *NASA-STD-3001 Vol 1*, Section 4.2 (Space Permissible Exposure Limits).

### F. Sensor Noise, Spikes & Dropouts (`SensorNoiseModel`)
- **Biological Basis**: Real medical telemetry suffers from electrode impedance drift, motion artifacts, lead-off disconnections, and EMI static discharges.
- **Core Dynamics**:
  - Gaussian sensor noise scaled with exercise motion intensity.
  - Deterministic spike injections exceeding rate-of-change filters (`max_rate_per_s`).
  - True sensor dropout windows yielding `value: null` for backend gap detection and interpolation.

---

## 3. Scripted Scenarios

All scenarios are defined in human-readable YAML in [`scenarios/`](file:///c:/Users/lokesh%20lohiya/OneDrive/Desktop/Arnav%20code/nasa/simulator/scenarios/):

| Scenario | File | Description |
| :--- | :--- | :--- |
| **Normal Day** | [`normal_day.yaml`](file:///c:/Users/lokesh%20lohiya/OneDrive/Desktop/Arnav%20code/nasa/simulator/scenarios/normal_day.yaml) | 24-hour diurnal cycle with sleep nadir, morning ops, 2h countermeasure workout, and rest. |
| **Heavy Exercise** | [`heavy_exercise.yaml`](file:///c:/Users/lokesh%20lohiya/OneDrive/Desktop/Arnav%20code/nasa/simulator/scenarios/heavy_exercise.yaml) | High-Intensity Interval Training (HIIT) on CEVIS cycle ergometer with active recovery. |
| **CO2 Rise** | [`co2_rise.yaml`](file:///c:/Users/lokesh%20lohiya/OneDrive/Desktop/Arnav%20code/nasa/simulator/scenarios/co2_rise.yaml) | ECLSS scrubber degradation causing hypercapnia (up to 9,500 ppm), tachypnea, and recovery. |
| **Sensor Dropout** | [`sensor_dropout.yaml`](file:///c:/Users/lokesh%20lohiya/OneDrive/Desktop/Arnav%20code/nasa/simulator/scenarios/sensor_dropout.yaml) | Pulse oximeter and chest band lead-off disconnections generating `null` readings. |
| **Spike Artifacts** | [`spike_artifacts.yaml`](file:///c:/Users/lokesh%20lohiya/OneDrive/Desktop/Arnav%20code/nasa/simulator/scenarios/spike_artifacts.yaml) | Single-sample rate-of-change spikes testing backend signal quality filtering. |
| **Cardiac Event in Blackout** | [`cardiac_event_during_blackout.yaml`](file:///c:/Users/lokesh%20lohiya/OneDrive/Desktop/Arnav%20code/nasa/simulator/scenarios/cardiac_event_during_blackout.yaml) | Acute supraventricular tachycardia during comms blackout testing autonomous onboard support. |
| **Slow Degradation** | [`slow_degradation_over_days.yaml`](file:///c:/Users/lokesh%20lohiya/OneDrive/Desktop/Arnav%20code/nasa/simulator/scenarios/slow_degradation_over_days.yaml) | Multi-sol Mars transit deconditioning, resting HR rise, and cumulative radiation accumulation. |

---

## 4. CLI Usage & Flags

The simulator can run in dry-run mode (local testing) or stream live batches directly to the AstroCare API over HTTP.

```bash
# Display CLI help and scenario catalog
python -m src.cli --help

# 1. Run dry-run simulation of a nominal 24-hour day (simulates 60 seconds)
python -m src.cli --scenario normal_day --duration 60 --dry-run

# 2. Transmit HIIT exercise scenario to backend at 10x speed with seed
python -m src.cli --scenario heavy_exercise --speed 10.0 --seed 42

# 3. Simulate CO2 scrubber failure for astronaut Lt. Maya Chen
python -m src.cli --scenario co2_rise --astronaut chen --seed 123

# 4. Stream sensor dropout scenario and export raw JSON telemetry to file
python -m src.cli --scenario sensor_dropout --duration 300 --output telemetry_out.json
```

### CLI Options Summary

- `--scenario, -s`: Scenario name or YAML path (`normal_day`, `heavy_exercise`, etc.)
- `--url`: Backend endpoint URL (default: `http://localhost:4000`)
- `--api-key`: `X-Ingest-Key` machine header (default: dev secret key)
- `--crew-id`: Target 24-character hex MongoDB ObjectId (default: Mercer `660e8400e29b41d4a7164466`)
- `--astronaut`: Preset profile: `mercer` (Cmdr. Alex Mercer) or `chen` (Lt. Maya Chen)
- `--rate`: Sampling frequency override in Hz (e.g. `1.0` or `0.5`)
- `--speed`: Time acceleration factor (`0.0` = unthrottled maximum throughput, `1.0` = real-time, `10.0` = 10x)
- `--seed`: Integer seed for 100% deterministic reproducibility
- `--batch-size`: Readings per HTTP batch (default: `35`, maximum: `500`)
- `--duration`: Maximum simulation run time in seconds
- `--dry-run`: Generate and display readings without transmitting HTTP requests
- `--output, -o`: Save all generated telemetry readings to a local JSON file
- `--quiet, -q`: Suppress per-batch progress logs

---

## 5. Verification & Testing

The simulator test suite verifies physiological boundaries, circadian oscillations, exercise kinetics, hypercapnia response, and strict determinism across all scenarios:

```bash
# Run pytest suite
python -m pytest

# Run with verbose output
python -m pytest -v
```
