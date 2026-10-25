import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupTestMongo,
  teardownTestMongo,
  clearTestMongo,
  createTestApp,
  createTestUser,
  authHeader,
} from './helpers.js';
import { CrewProfile } from '../src/models/CrewProfile.js';
import { OnboardingStatus } from '../src/models/OnboardingStatus.js';

describe('Astronaut Onboarding Status & Milestones (F007)', () => {
  beforeAll(async () => {
    await setupTestMongo();
  });

  afterAll(async () => {
    await teardownTestMongo();
  });

  beforeEach(async () => {
    await clearTestMongo();
  });

  it('initializes onboarding state with next_step as consent_acknowledged', async () => {
    const { user } = await createTestUser({ role: 'astronaut' });
    const { agent } = createTestApp();

    const res = await agent
      .get('/v1/onboarding/status')
      .set('Authorization', authHeader(user.id, 'astronaut'));

    expect(res.status).toBe(200);
    expect(res.body.user_id).toBe(user.id);
    expect(res.body.steps).toEqual({
      consent_acknowledged: false,
      profile_completed: false,
      device_paired: false,
      baseline_ready: false,
    });
    expect(res.body.next_step).toBe('consent_acknowledged');
    expect(res.body.completed_at).toBeNull();
  });

  it('updates consent_acknowledged advancing next_step to profile_completed', async () => {
    const { user } = await createTestUser({ role: 'astronaut' });
    const { agent } = createTestApp();

    const patchRes = await agent
      .patch('/v1/onboarding/status')
      .set('Authorization', authHeader(user.id, 'astronaut'))
      .send({ step: 'consent_acknowledged', done: true });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.steps.consent_acknowledged).toBe(true);
    expect(patchRes.body.next_step).toBe('profile_completed');
  });

  it('rejects profile_completed if astronaut has not created a crew profile', async () => {
    const { user } = await createTestUser({ role: 'astronaut' });
    const { agent } = createTestApp();

    const patchRes = await agent
      .patch('/v1/onboarding/status')
      .set('Authorization', authHeader(user.id, 'astronaut'))
      .send({ step: 'profile_completed', done: true });

    expect(patchRes.status).toBe(422);
    expect(patchRes.body.error.code).toBe('VALIDATION_ERROR');
    expect(patchRes.body.error.message).toContain('crew profile record');
  });

  it('allows profile_completed when astronaut crew profile exists', async () => {
    const { user } = await createTestUser({ role: 'astronaut' });
    const profile = await CrewProfile.create({
      user_id: user._id,
      callsign: 'Discovery-1',
      age: 33,
      sex: 'male',
      height_cm: 178,
      weight_kg: 72,
    });
    user.crew_profile_id = profile._id;
    await user.save();

    const { agent } = createTestApp();

    const patchRes = await agent
      .patch('/v1/onboarding/status')
      .set('Authorization', authHeader(user.id, 'astronaut'))
      .send({ step: 'profile_completed', done: true });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.steps.profile_completed).toBe(true);
    expect(patchRes.body.next_step).toBe('consent_acknowledged'); // since consent was not yet set
  });

  it('rejects reserved hardware steps (device_paired and baseline_ready) with 422', async () => {
    const { user } = await createTestUser({ role: 'astronaut' });
    const { agent } = createTestApp();

    // 1. device_paired reserved
    const res1 = await agent
      .patch('/v1/onboarding/status')
      .set('Authorization', authHeader(user.id, 'astronaut'))
      .send({ step: 'device_paired', done: true });

    expect(res1.status).toBe(422);
    expect(res1.body.error.code).toBe('VALIDATION_ERROR');
    expect(res1.body.error.message).toContain('reserved');

    // 2. baseline_ready reserved
    const res2 = await agent
      .patch('/v1/onboarding/status')
      .set('Authorization', authHeader(user.id, 'astronaut'))
      .send({ step: 'baseline_ready', done: true });

    expect(res2.status).toBe(422);
    expect(res2.body.error.code).toBe('VALIDATION_ERROR');
    expect(res2.body.error.message).toContain('reserved');
  });

  it('sets completed_at timestamp when all 4 milestones are true', async () => {
    const { user } = await createTestUser({ role: 'astronaut' });
    const profile = await CrewProfile.create({
      user_id: user._id,
      callsign: 'Discovery-2',
      age: 38,
      sex: 'female',
      height_cm: 165,
      weight_kg: 58,
    });
    user.crew_profile_id = profile._id;
    await user.save();

    // Set hardware steps in DB directly to simulate downstream backend services
    await OnboardingStatus.create({
      user_id: user._id,
      steps: {
        consent_acknowledged: true,
        profile_completed: false,
        device_paired: true,
        baseline_ready: true,
      },
    });

    const { agent } = createTestApp();

    // Completing the final pending step: profile_completed
    const patchRes = await agent
      .patch('/v1/onboarding/status')
      .set('Authorization', authHeader(user.id, 'astronaut'))
      .send({ step: 'profile_completed', done: true });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.completed_at).not.toBeNull();
    expect(patchRes.body.next_step).toBeNull();
  });

  it('allows administrator to audit any astronaut onboarding status', async () => {
    const { user: astronaut } = await createTestUser({ role: 'astronaut' });
    const { user: admin } = await createTestUser({ role: 'admin' });
    const { agent } = createTestApp();

    const res = await agent
      .get(`/v1/onboarding/status/${astronaut.id}`)
      .set('Authorization', authHeader(admin.id, 'admin'));

    expect(res.status).toBe(200);
    expect(res.body.user_id).toBe(astronaut.id);
  });
});
