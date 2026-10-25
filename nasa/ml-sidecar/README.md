# AstroCare — Machine Learning Decision-Support Sidecar

The **AstroCare ML Sidecar** (`/ml-sidecar`) is a real-time clinical AI service built with **FastAPI** and **scikit-learn** to provide autonomous physiological decision-support for astronauts operating under deep-space communication latency (Moon / Mars).

---

## Core Capabilities

### 1. Dual-Layer Anomaly Detection
Combines univariate statistical deviation with multivariate machine learning:
- **Rolling Z-Score vs Personal Baseline:** Tracks personal mean ($\mu$) and standard deviation ($\sigma$) per vital sign. Detects acute individual deviations ($|z| \ge 2.5$) while accounting for personal resting baseline characteristics.
- **Multi-Vital Isolation Forest (`sklearn.ensemble.IsolationForest`):** Identifies non-linear physiological co-variance breakdowns (e.g. tachycardia with concurrent hypotension and desaturation) while remaining invariant to concordant exercise adaptations.
- **Top Factor Attribution:** Each alert automatically computes up to 5 contributing factors matching the AstroCare external-alert schema:
  ```json
  {
    "name": "heart_rate",
    "direction": "up",
    "contribution": 0.65
  }
  ```

### 2. Spaceflight Early-Warning Risk Scorer (NEWS2 Adaptation)
Adapts the clinical gold-standard National Early Warning Score 2 (NEWS2) for microgravity physiology:
- **Respiration Rate:** Breaths/min ($\le 8$, $9-11$, $12-20$, $21-24$, $\ge 25$)
- **SpO2:** Oxygen saturation ($\le 91$, $92-93$, $94-95$, $\ge 96$)
- **Systolic Blood Pressure:** mmHg ($\le 90$, $91-100$, $101-110$, $111-219$, $\ge 220$)
- **Heart Rate:** Pulse in bpm ($\le 40$, $41-50$, $51-90$, $91-110$, $111-130$, $\ge 131$)
- **Core Temperature:** °C ($\le 35.0$, $35.1-36.0$, $36.1-38.0$, $38.1-39.0$, $\ge 39.1$)
- **Spaceflight Autonomic Strain (HRV RMSSD):** Evaluates parasympathetic withdrawal and acute adrenergic stress ($< 15\text{ ms} \rightarrow +2\text{ pts}$, $15-25\text{ ms} \rightarrow +1\text{ pt}$).
- **Severity Stratification:**
  - $0 - 2$: Nominal
  - $3 - 4$: `watch`
  - $5 - 6$: `warning`
  - $\ge 7$: `critical`

### 3. Personal Baseline Computation & Synchronization
- **Endpoint:** `PUT /v1/crew/:id/baseline`
- **Auth:** `X-ML-Key` service key or `flight_surgeon` / `admin` role.
- Robust estimators (trimmed median) filter out motion artifacts and exercise periods to compute stable resting vitals, setting `profile.baseline_status = 'computed'`.

### 4. Alert Dispatching & Batch Handling
- Posts to `POST /v1/alerts/external` with `X-ML-Key: ASTRO_ML_API_KEY`.
- Automatically chunks large alert sets to respect the backend limit of **100 alerts per batch**.
- Accurately tracks accepted and rejected items with global index offset mapping.

---

## Evaluation Harness (`/ml-sidecar/eval`)

The evaluation harness evaluates detection latency, false alarm rates, and precision/recall across all 7 digital twin scenarios:
- `cardiac_event_during_blackout`
- `co2_rise`
- `heavy_exercise`
- `normal_day`
- `sensor_dropout`
- `slow_degradation_over_days`
- `spike_artifacts`

### Running the Evaluation Benchmark
```bash
python ml-sidecar/eval/evaluate.py
```
Outputs:
- **Markdown Results Table:** [`docs/ML_EVALUATION.md`](../docs/ML_EVALUATION.md)
- **Multi-panel Benchmark Chart:** [`docs/ml_eval_benchmark.png`](../docs/ml_eval_benchmark.png)

---

## API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Service liveness, model metadata, and backend status |
| `POST` | `/infer` | Real-time multi-vital anomaly detection & risk scoring |
| `POST` | `/baseline/compute` | Compute per-crew resting baseline and sync to backend |
| `GET` | `/baseline/{crew_id}` | Retrieve cached baseline for crew member |
| `POST` | `/eval` | Run evaluation benchmark across simulator scenarios |

---

## Running Locally

```bash
# Install dependencies
pip install -r ml-sidecar/requirements.txt

# Run the FastAPI server
python -m uvicorn ml_sidecar.main:app --host 0.0.0.0 --port 8000 --reload

# Run pytest unit tests
pytest ml-sidecar/tests -v
```
