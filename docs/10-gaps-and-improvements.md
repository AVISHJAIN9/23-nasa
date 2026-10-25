# Gaps & Technical Roadmap

## Known Gaps
1. **Multi-Lead 12-Lead Raw ECG Streaming**: System currently ingests aggregated cardiac metrics (HR, ST-segment, arrhythmia flags) rather than streaming 500Hz raw 12-lead voltage waveforms.
2. **Radiation Dosimetry Sensor Integration**: Dosimetry data is currently ingested via generic telemetry endpoints rather than a dedicated ionizing radiation bio-dosimetry schema.

## Future Roadmap
- Implement WebAssembly-accelerated QRS complex detection directly in the browser dashboard.
- Integrate CCSDS (Consultative Committee for Space Data Systems) standard Space Packet Protocol framing.
