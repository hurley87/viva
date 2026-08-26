# Viva

Viva is a proof-of-understanding layer for education: a Teacher defines an Assignment and private Standard, a Student responds in a live voice Session, and the resulting transcript is assessed against that Standard.

## Language

### Objects

**Assignment**:
A Teacher-defined oral task with a prompt. Owns exactly one Standard and may have many Student Sessions. Published versions are immutable.
_Avoid_: exercise, homework

**Standard**:
A Teacher-written definition of what a competent oral response to an Assignment must demonstrate, composed of named criteria with short descriptors. Consumed only by the Grader—never present in a live Session (INV-3).
_Avoid_: rubric, grading scheme

**Criterion**:
One named element of a Standard. The unit the Grader rates and supports with transcript evidence.
_Avoid_: requirement, dimension

**Session**:
One time-boxed live voice response to a pinned Assignment version, conducted by the Examiner. Owns one transcript and receives one Assessment.
_Avoid_: exam, interview, attempt

**Transcript**:
The persisted text record of a Session and the sole Student evidence evaluated by the Grader. Raw audio is never stored.
_Avoid_: recording

**Assessment**:
The structured evaluation of one Session transcript against the pinned Standard, including the Examiner audit (INV-1 flags).
_Avoid_: grade, score, mark, result

### Human roles

**Teacher**:
The human expert who versions Assignments and Standards, reviews Assessments, and sets caps within Operator ceilings.
_Avoid_: author, professor, instructor

**Student**:
The person who completes oral Sessions and receives formative Assessments.
_Avoid_: defender, cadet, candidate, user

**Operator**:
Whoever runs the deployment. Sees aggregate metrics, spend, and flag rates only—never transcript content (INV-2).
_Avoid_: admin

### System agents

**Examiner**:
The realtime voice AI agent that conducts a Session. Questions, challenges, and presses—never supplies the Student's position (INV-1).
_Avoid_: interviewer, examiner bot

**Grader**:
The text-model evaluator that produces an Assessment from a transcript and private Standard, and independently audits the Examiner for INV-1 violations.
_Avoid_: evaluator, judge, marker
