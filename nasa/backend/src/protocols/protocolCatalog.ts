/**
 * @module protocolCatalog
 * Authoritative clinical checklists for spaceflight medical emergencies during comms delay / blackout.
 *
 * Covers all 6 primary hazard categories:
 * - cardiovascular
 * - respiratory
 * - thermal
 * - autonomic_stress
 * - cabin_environment
 * - radiation
 */

import { type ProtocolChecklist } from '../schemas/protocols.js';

export const PROTOCOL_CATALOG: ProtocolChecklist[] = [
  {
    protocol_id: 'PROTO-CV-01',
    hazard_type: 'cardiovascular',
    title: 'ACLS Microgravity Acute Arrhythmia & Hemodynamic Instability',
    version: '1.2.0',
    indication:
      'Sustained tachycardia (>140 bpm), acute bradycardia (<40 bpm), ventricular ectopic runs, or acute hemodynamic collapse under microgravity fluid-shift.',
    autonomous_priority: 'immediate',
    steps: [
      {
        step_id: 'cv-s1',
        order: 1,
        title: 'Initial Assessment & Microgravity Restraint Ingress',
        instruction:
          'Confirm responsiveness, carotid pulse, and SpO2 plethysmogram. Secure patient into Crew Medical Restraint (CMR) to prevent chest compression recoil.',
        criticality: 'critical',
        expected_telemetry_effect: 'Stabilization of accelerometer artifacts on ECG/PPG leads.',
        requires_cmo_confirmation: true,
      },
      {
        step_id: 'cv-s2',
        order: 2,
        title: 'Continuous 12-Lead ECG Acquisition & Rhythm Identification',
        instruction:
          'Attach 12-lead ECG electrode array. Differentiate SVT, atrial fibrillation with RVR, versus ventricular tachycardia (VT).',
        criticality: 'critical',
        expected_telemetry_effect: 'ECG stream clarity restored; rhythm classification logged.',
        requires_cmo_confirmation: true,
      },
      {
        step_id: 'cv-s3',
        order: 3,
        title: 'Vagal Maneuver / Antiarrhythmic Pharmacotherapy',
        instruction:
          'If stable SVT: perform modified Valsalva maneuver (forced exhalation against closed glottis with leg elevation). If VT with pulse or refractory SVT: administer Adenosine 6mg rapid IV flush or Amiodarone 150mg IV over 10 min.',
        criticality: 'critical',
        expected_telemetry_effect:
          'Transient PR prolongation, conversion to normal sinus rhythm, HR < 100 bpm.',
        requires_cmo_confirmation: true,
      },
      {
        step_id: 'cv-s4',
        order: 4,
        title: 'Post-Resuscitation Hemodynamic Monitoring',
        instruction:
          'Measure non-invasive blood pressure every 2 minutes. Administer 250 mL IV normal saline bolus if mean arterial pressure (MAP) < 65 mmHg.',
        criticality: 'monitoring',
        expected_telemetry_effect: 'MAP > 70 mmHg, SpO2 > 95%.',
        requires_cmo_confirmation: false,
      },
    ],
  },
  {
    protocol_id: 'PROTO-RESP-01',
    hazard_type: 'respiratory',
    title: 'Cabin Hypercapnia & Severe Respiratory Distress Protocol',
    version: '1.1.0',
    indication:
      'Elevated cabin ppCO2 (>4.0 mmHg), tachypnea (>26 bpm), dyspnea, confusion, or SpO2 dropping below 92%.',
    autonomous_priority: 'immediate',
    steps: [
      {
        step_id: 'resp-s1',
        order: 1,
        title: 'Emergency 100% Oxygen Donning',
        instruction:
          'Immediately don Portable Breathing Apparatus (PBA) or Quick-Don 100% Oxygen mask at 6 L/min flow rate.',
        criticality: 'critical',
        expected_telemetry_effect: 'SpO2 increases toward 98-100%; respiratory rate decreases.',
        requires_cmo_confirmation: true,
      },
      {
        step_id: 'resp-s2',
        order: 2,
        title: 'Cabin Atmospheric Scrubber Emergency Swap',
        instruction:
          'Verify Environmental Control and Life Support System (ECLSS) Carbon Dioxide Removal Assembly (CDRA). Manually replace spent Lithium Hydroxide (LiOH) canister.',
        criticality: 'critical',
        expected_telemetry_effect: 'Cabin ppCO2 decreases below 3.0 mmHg within 15 minutes.',
        requires_cmo_confirmation: true,
      },
      {
        step_id: 'resp-s3',
        order: 3,
        title: 'Bronchodilator Inhalation Therapy',
        instruction:
          'Administer Albuterol / Ipratropium inhaler (2 puffs via spacer) if wheezing, bronchospasm, or coughing paroxysms occur.',
        criticality: 'standard',
        expected_telemetry_effect:
          'Decreased airway resistance and normalization of respiratory rate.',
        requires_cmo_confirmation: false,
      },
    ],
  },
  {
    protocol_id: 'PROTO-THERM-01',
    hazard_type: 'thermal',
    title: 'EVA / Cabin Core Hypothermia & Hyperthermia Protocol',
    version: '1.0.0',
    indication:
      'Core body temperature < 35.0°C (hypothermia) or > 38.5°C (hyperthermia) detected via sensor telemetry or tympanic thermometer.',
    autonomous_priority: 'urgent',
    steps: [
      {
        step_id: 'therm-s1',
        order: 1,
        title: 'Thermal Loop Verification & Garment Inspection',
        instruction:
          'Inspect Liquid Cooling and Ventilation Garment (LCVG) valves and cabin module HVAC thermoloop bypass valves.',
        criticality: 'standard',
        expected_telemetry_effect: 'Coolant loop flow rate and cabin temperature normalize.',
        requires_cmo_confirmation: true,
      },
      {
        step_id: 'therm-s2',
        order: 2,
        title: 'Active Temperature Modulation',
        instruction:
          'If Hypothermic: wrap in radiant thermal space blanket, deliver warm humidified oxygen. If Hyperthermic: apply cool mist, ice packs to axillae/groin, and maximize cabin forced convection fans.',
        criticality: 'critical',
        expected_telemetry_effect:
          'Core temperature moves toward 36.5°C–37.5°C at 0.5°C per 30 minutes.',
        requires_cmo_confirmation: true,
      },
    ],
  },
  {
    protocol_id: 'PROTO-AUTO-01',
    hazard_type: 'autonomic_stress',
    title: 'Microgravity Orthostatic Intolerance & Autonomic Storm Protocol',
    version: '1.0.0',
    indication:
      'Severe presyncope, reflex tachycardia, marked HRV suppression (LF/HF ratio > 4.0), or autonomic dysregulation upon g-transition or exercise.',
    autonomous_priority: 'urgent',
    steps: [
      {
        step_id: 'auto-s1',
        order: 1,
        title: 'Horizontal Posture & Anti-G Countermeasures',
        instruction:
          'Place astronaut into reclined rest position with lower extremities elevated. Inflate lower-body counterpressure garment to 35 mmHg.',
        criticality: 'standard',
        expected_telemetry_effect:
          'Increase in venous return; decrease in compensatory resting heart rate.',
        requires_cmo_confirmation: true,
      },
      {
        step_id: 'auto-s2',
        order: 2,
        title: 'Oral Electrolyte Fluid Reconstitution',
        instruction:
          'Administer 1000 mL isotonic electrolyte fluid (AstroLyte) orally over 45 minutes to restore effective circulating blood volume.',
        criticality: 'standard',
        expected_telemetry_effect:
          'Blood pressure stabilization; HRV parasympathetic recovery (RMSSD > 30 ms).',
        requires_cmo_confirmation: false,
      },
    ],
  },
  {
    protocol_id: 'PROTO-ENV-01',
    hazard_type: 'cabin_environment',
    title: 'Rapid Cabin Depressurization & Toxic Gas Ingress Protocol',
    version: '1.3.0',
    indication:
      'Cabin barometric pressure drop rate > 1 kPa/min or trace contaminant detector alarm for toxic ammonia / volatile organics.',
    autonomous_priority: 'immediate',
    steps: [
      {
        step_id: 'env-s1',
        order: 1,
        title: 'Immediate Intravehicular Activity (IVA) Helmet Seal',
        instruction:
          'Sound emergency audible klaxon. Ingress IVA pressure suits, lock visors, and initiate internal suit closed-loop oxygen supply.',
        criticality: 'critical',
        expected_telemetry_effect: 'Suit pressure regulated to 29.6 kPa; SpO2 maintained > 95%.',
        requires_cmo_confirmation: true,
      },
      {
        step_id: 'env-s2',
        order: 2,
        title: 'Bulkhead Hatch Isolation & Module Leak Triage',
        instruction:
          'Isolate leaking or contaminated module by sealing airtight inter-module hatches. Verify hatch differential pressure delta.',
        criticality: 'critical',
        expected_telemetry_effect: 'Arrest of pressure decay in adjacent safe haven modules.',
        requires_cmo_confirmation: true,
      },
      {
        step_id: 'env-s3',
        order: 3,
        title: 'Atmospheric Scrubber Toxic Scrub Activation',
        instruction:
          'Engage emergency catalytic oxidizer and activated carbon adsorption beds for toxic contaminant neutralization.',
        criticality: 'standard',
        expected_telemetry_effect: 'Ammonia and VOC sensors decay to baseline zero.',
        requires_cmo_confirmation: false,
      },
    ],
  },
  {
    protocol_id: 'PROTO-RAD-01',
    hazard_type: 'radiation',
    title: 'Solar Particle Event (SPE) Radiation Shelter & Biodosimetry Protocol',
    version: '1.1.0',
    indication:
      'Dosimeter dose rate > 100 µSv/hr, solar proton flux alert, or acute radiation warning.',
    autonomous_priority: 'urgent',
    steps: [
      {
        step_id: 'rad-s1',
        order: 1,
        title: 'Retreat to Storm Shelter Core Module',
        instruction:
          'Direct all crew members to immediate ingress into water-wall shielded radiation storm shelter. Secure inner shelter polyethylene thermal curtains.',
        criticality: 'critical',
        expected_telemetry_effect: 'Personal dosimeter dose rates attenuate by >= 70%.',
        requires_cmo_confirmation: true,
      },
      {
        step_id: 'rad-s2',
        order: 2,
        title: 'Radioprotectant Prophylaxis Administration',
        instruction:
          'Administer oral antioxidant radioprotectant countermeasures (Amifostine analogue and Vitamin C/E cocktail) per mission medical protocol.',
        criticality: 'standard',
        expected_telemetry_effect: 'Prophylactic countermeasure logging completed.',
        requires_cmo_confirmation: true,
      },
      {
        step_id: 'rad-s3',
        order: 3,
        title: 'Onboard Biodosimetry Capillary Blood Analysis',
        instruction:
          'Perform baseline capillary blood sampling using onboard microfluidic hematology analyzer to record lymphocyte absolute counts.',
        criticality: 'monitoring',
        expected_telemetry_effect:
          'Baseline hematology panel archived for ground flight surgeon review.',
        requires_cmo_confirmation: false,
      },
    ],
  },
];
