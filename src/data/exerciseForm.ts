// Curated form guidance for the built-in lifts (keys match src/data/exercises.ts).
// General, widely-taught cues — not a substitute for a qualified coach. Custom
// exercises have no entry here; users add their own via exercise_notes.

export interface ExerciseForm {
  setup?: string[] // getting into the start position
  cues: string[] // the key execution cues, in order
  mistakes?: string[] // common things to avoid
}

export const EXERCISE_FORM: Record<string, ExerciseForm> = {
  // ---- Chest ----
  bench_press: {
    setup: [
      'Lie back with your eyes under the bar and feet planted flat.',
      'Squeeze your shoulder blades down and back into the bench.',
      'Grip slightly wider than shoulder-width.',
    ],
    cues: [
      'Unrack and hold the bar over your shoulders.',
      'Lower under control to mid-chest, elbows about 45–75° from your torso.',
      'Touch the chest without bouncing, then press up and slightly back over your face.',
    ],
    mistakes: [
      'Flaring the elbows out to 90°.',
      'Bouncing the bar off the chest.',
      'Lifting the hips off the bench.',
    ],
  },
  incline_bench_press: {
    setup: [
      'Set the bench to roughly 30–45°.',
      'Eyes under the bar, shoulder blades retracted, feet flat.',
    ],
    cues: [
      'Lower the bar to the upper chest / collarbone line.',
      'Keep elbows about 45° from the torso.',
      'Press up and over the shoulders.',
    ],
    mistakes: [
      'Setting the incline too steep (it becomes a shoulder press).',
      'Bouncing the bar off the chest.',
      'Flaring the elbows.',
    ],
  },
  db_bench_press: {
    setup: [
      'Sit with the dumbbells on your thighs, then kick them up as you lie back.',
      'Retract your shoulder blades and plant your feet.',
    ],
    cues: [
      'Start with the dumbbells stacked over your chest.',
      'Lower to chest level with elbows about 45° from the torso.',
      'Press up and slightly together.',
    ],
    mistakes: [
      'Letting the dumbbells drift over your face.',
      'Flaring the elbows.',
      'Clanging the bells together at the top.',
    ],
  },
  chest_fly: {
    setup: [
      'Set a soft, fixed bend in the elbows.',
      'Stagger your stance for balance and keep the chest up.',
    ],
    cues: [
      'Keep the slight elbow bend fixed throughout.',
      'Bring your hands together in a wide arc in front of the chest.',
      'Squeeze the chest, then control the stretch back.',
    ],
    mistakes: [
      'Turning it into a press by bending the elbows.',
      'Overstretching at the bottom.',
      'Using too much weight.',
    ],
  },
  push_up: {
    setup: [
      'Hands slightly wider than your shoulders.',
      'Body in a straight line from head to heels; brace core and glutes.',
    ],
    cues: [
      'Lower until your chest is just above the floor.',
      'Keep elbows about 45° from the torso.',
      'Push the floor away and keep the body rigid.',
    ],
    mistakes: [
      'Sagging or piking the hips.',
      'Flaring elbows out to 90°.',
      'Cutting the range short.',
    ],
  },
  // ---- Back ----
  deadlift: {
    setup: [
      'Bar over mid-foot, feet about hip-width.',
      'Hinge down and grip just outside your knees, shins to the bar.',
      'Chest up, flat back, lats engaged.',
    ],
    cues: [
      'Take the slack out of the bar before you pull.',
      'Push the floor away and drag the bar up your legs.',
      'Lock out by standing tall and squeezing the glutes — keep a neutral spine.',
    ],
    mistakes: [
      'Rounding the lower back.',
      'Letting the bar drift away from the body.',
      'Hips shooting up first (it becomes a stiff-leg).',
    ],
  },
  pull_up: {
    setup: [
      'Grip slightly wider than shoulders, palms facing away.',
      'Hang with shoulders active (not shrugged up to the ears).',
    ],
    cues: [
      'Pull your elbows down and back.',
      'Lead with the chest toward the bar.',
      'Drive until your chin clears the bar, then lower to a full hang.',
    ],
    mistakes: [
      'Kipping or swinging for momentum.',
      'Cutting the range short.',
      'Shrugging instead of depressing the shoulders.',
    ],
  },
  chin_up: {
    setup: [
      'Grip about shoulder-width, palms facing you.',
      'Start from an active dead hang.',
    ],
    cues: [
      'Pull your elbows down toward your ribs.',
      'Drive the chest to the bar and squeeze biceps and lats.',
      'Lower under control to a full hang.',
    ],
    mistakes: [
      'Swinging or kipping.',
      'Cutting the range short.',
      'Not fully extending at the bottom.',
    ],
  },
  lat_pulldown: {
    setup: [
      'Grip wider than shoulder-width.',
      'Secure your thighs under the pad; chest up with a slight lean back.',
    ],
    cues: [
      'Pull your elbows down and toward the floor.',
      'Bring the bar to your upper chest and squeeze the lats.',
      'Control the bar back up to a full stretch.',
    ],
    mistakes: [
      'Leaning back excessively.',
      'Pulling the bar behind your neck.',
      'Jerking with momentum.',
    ],
  },
  barbell_row: {
    setup: [
      'Hinge at the hips to about 45° or lower, flat back.',
      'Let the bar hang at arm’s length, grip just outside the knees.',
    ],
    cues: [
      'Pull the bar to your lower chest / upper stomach.',
      'Drive your elbows back and squeeze the shoulder blades.',
      'Lower under control.',
    ],
    mistakes: [
      'Standing up / using body English to heave the bar.',
      'Rounding the back.',
      'Shrugging instead of rowing.',
    ],
  },
  db_row: {
    setup: [
      'Place one hand and knee on a bench, flat back.',
      'Let the dumbbell hang straight down.',
    ],
    cues: [
      'Row the dumbbell to your hip.',
      'Drive the elbow back and up, squeezing the shoulder blade.',
      'Lower to a full stretch.',
    ],
    mistakes: [
      'Rotating the torso to heave the weight.',
      'Shrugging the shoulder.',
      'Using a short range of motion.',
    ],
  },
  seated_cable_row: {
    setup: [
      'Feet on the platform with soft knees; sit tall.',
      'Slight lean forward from the hips, chest up.',
    ],
    cues: [
      'Pull the handle to your stomach.',
      'Drive your elbows back close to your body and squeeze the shoulder blades.',
      'Control the return to a full stretch.',
    ],
    mistakes: [
      'Rocking back and forth for momentum.',
      'Rounding the back during the stretch.',
      'Shrugging the shoulders.',
    ],
  },
  face_pull: {
    setup: [
      'Set the rope at upper-chest / face height.',
      'Grip with thumbs back; step back for tension and stand tall.',
    ],
    cues: [
      'Pull the rope toward your face/forehead.',
      'Separate your hands and lead with high elbows.',
      'Squeeze the rear delts, then control the return.',
    ],
    mistakes: [
      'Using too much weight (it becomes a row).',
      'Dropping the elbows.',
      'Shrugging the traps.',
    ],
  },
  // ---- Legs ----
  back_squat: {
    setup: [
      'Bar on your upper traps / rear delts, hands just outside the shoulders.',
      'Feet shoulder-width, toes slightly out; brace your core, chest up.',
    ],
    cues: [
      'Break at the hips and knees together and sit down between your legs.',
      'Keep your knees tracking over your toes.',
      'Descend to at least parallel, then drive up through mid-foot.',
    ],
    mistakes: [
      'Knees caving inward.',
      'Heels lifting off the floor.',
      'Rounding the lower back at the bottom.',
    ],
  },
  front_squat: {
    setup: [
      'Rest the bar on your front delts with elbows high (clean or crossed grip).',
      'Feet shoulder-width, core braced.',
    ],
    cues: [
      'Keep your elbows up and torso upright.',
      'Sit straight down with knees tracking over toes.',
      'Drive up keeping the chest tall.',
    ],
    mistakes: [
      'Elbows dropping (the bar rolls forward).',
      'Rounding the upper back.',
      'Heels rising.',
    ],
  },
  leg_press: {
    setup: [
      'Feet shoulder-width in the middle of the platform.',
      'Back and hips flat against the pads; release the safeties.',
    ],
    cues: [
      'Lower until your knees reach about 90°.',
      'Keep your knees tracking over your toes.',
      'Press through your whole foot; don’t slam the knees straight.',
    ],
    mistakes: [
      'Letting the lower back round / hips lift off the seat.',
      'Bouncing at the bottom.',
      'Knees caving inward.',
    ],
  },
  lunge: {
    setup: [
      'Stand tall, feet hip-width, dumbbells at your sides.',
      'Brace your core.',
    ],
    cues: [
      'Step forward into a long stride.',
      'Drop the back knee toward the floor, front shin roughly vertical.',
      'Push through the front heel to return.',
    ],
    mistakes: [
      'Front knee caving in or shooting well past the toes.',
      'Leaning the torso forward.',
      'Taking too short a stride.',
    ],
  },
  romanian_deadlift: {
    setup: [
      'Stand with the bar at your hips, soft knees.',
      'Shoulders back, bar against the thighs.',
    ],
    cues: [
      'Push your hips back and let the bar drag down your legs.',
      'Lower until you feel a hamstring stretch (around shin level), back flat.',
      'Drive the hips forward to stand tall.',
    ],
    mistakes: [
      'Bending the knees too much (it becomes a deadlift).',
      'Rounding the back.',
      'Letting the bar drift away from the legs.',
    ],
  },
  leg_curl: {
    setup: [
      'Set the pad just above your heels / Achilles.',
      'Align your knees with the machine’s pivot; hold the handles.',
    ],
    cues: [
      'Curl your heels toward your glutes.',
      'Squeeze the hamstrings at the top.',
      'Control the weight back; keep your hips down on the pad.',
    ],
    mistakes: [
      'Lifting the hips to cheat the weight up.',
      'Using momentum.',
      'A short range of motion.',
    ],
  },
  leg_extension: {
    setup: [
      'Pad on your lower shins, just above the ankles.',
      'Knees aligned with the pivot; sit back into the seat.',
    ],
    cues: [
      'Extend your knees to straight.',
      'Squeeze the quads at the top.',
      'Lower under control, back against the pad.',
    ],
    mistakes: [
      'Swinging / using momentum.',
      'Slamming the weight down.',
      'Setting the pad too high on the shin.',
    ],
  },
  calf_raise: {
    setup: [
      'Balls of the feet on the platform, heels free.',
      'Stand tall under the pad (or per the machine).',
    ],
    cues: [
      'Drop your heels for a full stretch.',
      'Rise up onto your toes as high as possible.',
      'Pause and squeeze at the top, then lower slowly.',
    ],
    mistakes: [
      'Bouncing through partial reps.',
      'Rushing the movement.',
      'Skipping the full stretch or full contraction.',
    ],
  },
  hip_thrust: {
    setup: [
      'Upper back on a bench, bar over your hips (use a pad).',
      'Feet flat with shins vertical at the top; chin tucked.',
    ],
    cues: [
      'Drive through your heels.',
      'Push the hips up until your torso is parallel to the floor.',
      'Squeeze the glutes hard at the top, then lower under control.',
    ],
    mistakes: [
      'Overarching the lower back at the top.',
      'Pushing through the toes.',
      'Using a short range of motion.',
    ],
  },
  // ---- Shoulders ----
  overhead_press: {
    setup: [
      'Bar on your front delts at collarbone height, grip just outside the shoulders.',
      'Feet shoulder-width; brace your glutes and core.',
    ],
    cues: [
      'Press the bar straight up, moving your head back slightly to clear your chin.',
      'Once past your forehead, push your head “through the window”.',
      'Lock out with the bar over your mid-foot; keep your ribs down.',
    ],
    mistakes: [
      'Excessive lower-back lean.',
      'Pressing the bar out in front of you.',
      'Letting the wrists bend back.',
    ],
  },
  db_shoulder_press: {
    setup: [
      'Sit or stand with dumbbells at shoulder height, palms forward.',
      'Brace your core.',
    ],
    cues: [
      'Press the dumbbells up and slightly together.',
      'Keep your wrists stacked over your elbows.',
      'Lock out overhead, then lower under control to ear level.',
    ],
    mistakes: [
      'Arching the lower back.',
      'Flaring the elbows too far forward.',
      'Bouncing at the bottom.',
    ],
  },
  lateral_raise: {
    setup: [
      'Stand tall, dumbbells at your sides, slight bend in the elbows.',
      'Soft knees, core braced.',
    ],
    cues: [
      'Raise the dumbbells out to the sides to about shoulder height.',
      'Lead with your elbows.',
      'Keep a slight forward tilt (like pouring out a cup), then lower slowly.',
    ],
    mistakes: [
      'Swinging / using momentum.',
      'Shrugging the traps.',
      'Going well above shoulder height.',
    ],
  },
  // ---- Arms ----
  barbell_curl: {
    setup: [
      'Stand tall, grip shoulder-width with palms up.',
      'Pin your elbows to your sides.',
    ],
    cues: [
      'Curl the bar up by flexing the biceps.',
      'Keep your elbows still at your sides.',
      'Squeeze at the top, then lower under control.',
    ],
    mistakes: [
      'Swinging the torso.',
      'Letting the elbows drift forward.',
      'Dropping the weight on the way down.',
    ],
  },
  db_curl: {
    setup: [
      'Stand or sit with dumbbells at your sides, palms facing in.',
      'Elbows pinned to your sides.',
    ],
    cues: [
      'Curl up, rotating your palm to face up as you lift.',
      'Squeeze the biceps at the top.',
      'Lower slowly with control.',
    ],
    mistakes: [
      'Swinging the body.',
      'Letting the elbows move forward.',
      'Rushing the lowering phase.',
    ],
  },
  hammer_curl: {
    setup: [
      'Stand tall, dumbbells at your sides with a neutral grip (palms facing in).',
      'Pin your elbows.',
    ],
    cues: [
      'Curl up keeping the thumbs-up / neutral grip.',
      'Squeeze at the top.',
      'Lower under control.',
    ],
    mistakes: [
      'Swinging the body.',
      'Letting the elbows drift.',
      'Rushing the negative.',
    ],
  },
  tricep_pushdown: {
    setup: [
      'Use a high pulley with a bar or rope.',
      'Tuck your elbows at your sides with a slight forward lean.',
    ],
    cues: [
      'Extend your elbows to lockout.',
      'Keep your upper arms still at your sides.',
      'Squeeze the triceps at the bottom, then control the weight back up.',
    ],
    mistakes: [
      'Flaring the elbows out.',
      'Using the shoulders / leaning to push the weight.',
      'A short range at the top.',
    ],
  },
  overhead_tricep_ext: {
    setup: [
      'Hold a dumbbell overhead (both hands, or one per hand).',
      'Elbows pointing up; brace your core.',
    ],
    cues: [
      'Lower the weight behind your head by bending the elbows.',
      'Keep your upper arms vertical and still.',
      'Extend to lockout and squeeze the triceps.',
    ],
    mistakes: [
      'Letting the elbows flare wide.',
      'Arching the lower back.',
      'Moving the upper arms.',
    ],
  },
  dip: {
    setup: [
      'Support yourself on parallel bars with arms locked.',
      'Lean forward slightly for more chest, stay upright for more triceps.',
    ],
    cues: [
      'Lower until your elbows reach about 90°.',
      'Keep your elbows tracking back, not flaring wide.',
      'Press back up to lockout; keep your shoulders down.',
    ],
    mistakes: [
      'Going too deep and stressing the shoulders.',
      'Flaring the elbows.',
      'Shrugging up at the bottom.',
    ],
  },
  // ---- Core ----
  plank: {
    setup: [
      'Forearms under your shoulders, feet hip-width.',
      'Body in a straight line from head to heels.',
    ],
    cues: [
      'Brace your abs and squeeze your glutes.',
      'Tuck your pelvis slightly and keep your neck neutral.',
      'Breathe steadily and hold the line.',
    ],
    mistakes: [
      'Sagging or piking the hips.',
      'Holding your breath.',
      'Letting your head drop.',
    ],
  },
  crunch: {
    setup: [
      'Lie on your back, knees bent, feet flat.',
      'Hands by your ears or across your chest.',
    ],
    cues: [
      'Curl your shoulder blades off the floor by contracting the abs.',
      'Exhale at the top.',
      'Lower slowly; keep your lower back down.',
    ],
    mistakes: [
      'Pulling on your neck.',
      'Using momentum.',
      'Sitting all the way up (hip flexors take over).',
    ],
  },
  hanging_leg_raise: {
    setup: [
      'Hang from a bar with an active grip and engaged shoulders.',
      'Legs together.',
    ],
    cues: [
      'Raise your legs by curling your pelvis up.',
      'Keep the movement controlled — no swinging.',
      'Lower slowly.',
    ],
    mistakes: [
      'Swinging / using momentum.',
      'Only lifting the legs without curling the pelvis.',
      'Dropping down too fast.',
    ],
  },
}

export function getExerciseForm(
  key: string | undefined,
): ExerciseForm | undefined {
  return key ? EXERCISE_FORM[key] : undefined
}
