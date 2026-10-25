# Predictive Clinical ML Sidecar

## Architecture
- **Framework**: Python FastAPI sidecar running an optimized gradient boosted tree model (LightGBM/XGBoost).
- **Inputs**: 15-minute sliding windows of normalized heart rate, SpO2, blood pressure, and core temperature.
- **Output**: Decompensation probability ($0.0$ to $1.0$) and dominant clinical risk factor.

```mermaid
flowchart LR
    Vitals[Time-Series Readings] --> Window[15-Minute Rolling Window]
    Window --> FeatExt[Feature Extraction (Mean, Var, Slope)]
    FeatExt --> Model[Gradient Boosted Model]
    Model --> Risk{Decompensation Risk > 0.75?}
    Risk -->|Yes| Alert[Predictive Alert to Medic]
    Risk -->|No| Normal[Routine Logging]
```
