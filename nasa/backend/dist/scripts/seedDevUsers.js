import { loadConfig } from '../core/config.js';
import { connectMongo, disconnectMongo } from '../core/db.js';
import { User } from '../models/User.js';
import { CrewProfile } from '../models/CrewProfile.js';
import { OnboardingStatus } from '../models/OnboardingStatus.js';
import { hashPassword } from '../core/passwords.js';
const SEED_USERS = [
    {
        email: 'admin@astrocare.nasa.gov',
        display_name: 'Dr. Marcus Vance (Admin)',
        role: 'admin',
        is_medical_officer: false,
        password: process.env['ASTRO_SEED_ADMIN_PASSWORD'] || 'AdminSecret#2026',
    },
    {
        email: 'surgeon@astrocare.nasa.gov',
        display_name: 'Dr. Sarah Connor (Flight Surgeon)',
        role: 'flight_surgeon',
        is_medical_officer: false,
        password: process.env['ASTRO_SEED_SURGEON_PASSWORD'] || 'SurgeonSecret#2026',
    },
    {
        email: 'control@astrocare.nasa.gov',
        display_name: 'Gene Kranz (Flight Director)',
        role: 'mission_control',
        is_medical_officer: false,
        password: process.env['ASTRO_SEED_CONTROL_PASSWORD'] || 'ControlSecret#2026',
    },
    {
        email: 'mercer@astrocare.nasa.gov',
        display_name: 'Cmdr. Alex Mercer',
        role: 'astronaut',
        is_medical_officer: false,
        password: process.env['ASTRO_SEED_ASTRONAUT_PASSWORD'] || 'AstroSecret#2026',
        callsign: 'Ares-Lead',
    },
    {
        email: 'chen@astrocare.nasa.gov',
        display_name: 'Lt. Maya Chen (Medical Officer)',
        role: 'astronaut',
        is_medical_officer: true,
        password: process.env['ASTRO_SEED_MEDIC_PASSWORD'] || 'MedicSecret#2026',
        callsign: 'Ares-Medic',
    },
];
async function seed() {
    const settings = loadConfig();
    if (settings.env === 'prod') {
        console.error('❌ Refusing to run seed script in production environment (ASTRO_ENV=prod).');
        process.exit(1);
    }
    console.log('🛰️ Connecting to database for dev user seeding...');
    await connectMongo(settings.mongodb_uri);
    console.log('\n=================== ASTROCARE SEED USERS ===================');
    for (const spec of SEED_USERS) {
        const password_hash = await hashPassword(spec.password);
        let user = await User.findOne({ email: spec.email });
        if (!user) {
            user = await User.create({
                email: spec.email,
                display_name: spec.display_name,
                role: spec.role,
                is_medical_officer: spec.is_medical_officer,
                password_hash,
                status: 'active',
            });
            console.log(`✅ Created user: ${spec.email} [${spec.role}]`);
        }
        else {
            user.display_name = spec.display_name;
            user.role = spec.role;
            user.is_medical_officer = spec.is_medical_officer;
            user.password_hash = password_hash;
            user.status = 'active';
            await user.save();
            console.log(`♻️  Updated user: ${spec.email} [${spec.role}]`);
        }
        // Seed astronaut profile & onboarding if astronaut
        if (spec.role === 'astronaut' && spec.callsign) {
            let profile = await CrewProfile.findOne({ user_id: user._id });
            if (!profile) {
                profile = await CrewProfile.create({
                    user_id: user._id,
                    callsign: spec.callsign,
                    age: 36,
                    sex: 'female',
                    height_cm: 172,
                    weight_kg: 64,
                    medical_history: ['Penicillin allergy', 'Slight motion sickness Sol 1-3'],
                    baseline: {
                        resting_hr: 58,
                        spo2: 98,
                        systolic: 116,
                        diastolic: 74,
                        temp_c: 36.6,
                        resp_rate: 13,
                        hrv_rmssd: 68,
                    },
                    baseline_status: 'computed',
                    is_synthetic: true,
                });
                user.crew_profile_id = profile._id;
                await user.save();
            }
            const onboarding = await OnboardingStatus.findOne({ user_id: user._id });
            if (!onboarding) {
                await OnboardingStatus.create({
                    user_id: user._id,
                    steps: {
                        consent_acknowledged: true,
                        profile_completed: true,
                        device_paired: false,
                        baseline_ready: false,
                    },
                });
            }
        }
        console.log(`   Email:    ${spec.email}`);
        console.log(`   Password: ${spec.password}`);
        console.log(`   Role:     ${spec.role} (MO: ${spec.is_medical_officer})\n`);
    }
    console.log('============================================================');
    console.log('🚀 Seeding complete.');
    await disconnectMongo();
}
seed().catch(async (err) => {
    console.error('Fatal seeding error:', err);
    await disconnectMongo();
    process.exit(1);
});
