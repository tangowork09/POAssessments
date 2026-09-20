-- The Collaboration Diagnostic goes live.
--
-- A third instrument shape. The two self-ratings report on the person who
-- answered and Sociometry reports on a group by having its members rate each
-- other; this one is a self-report *about the organisation*. Around fifty
-- leaders answer the same 24 statements about the company they work in, and
-- the finding only exists once those answers are averaged. The deliverable is
-- one group report, not fifty individual ones.
--
-- Nothing new is needed to collect it: 24 statements rated 1-5 sit in
-- `questions` and `answers` exactly as the other instruments do. What is
-- code-shaped lives in src/shared/collab.ts (the statements, which of them are
-- reverse-scored, and which section each belongs to) and in the registry entry
-- in src/shared/assessments.ts.
--
-- Two things are deliberately NOT in this migration:
--
--   1. Section titles and direct/reverse tags. The master copy's participant
--      version is the instructions, the scale and the 24 statements, nothing
--      more. A respondent who can see that a statement sits under "Trust &
--      Safety" answers it differently, so that structure stays facilitator-side
--      in code and is never served to a candidate.
--   2. Scoring rows in `scoring_styles`. That table models a style as a bag of
--      item numbers, which cannot express "6 minus the answer" -- and getting
--      the direction of an item wrong is silent in the output, it just moves a
--      mean. The conversion lives in one tested place instead
--      (src/shared/collab-scoring.ts).
--
-- Statement numbers are addresses: they are what `answers.no` stores. They are
-- never renumbered and a retired number is never reused.

INSERT INTO assessments (id, slug, name, description, status, question_count, per_page, min_answer, max_answer)
VALUES (
  'asm_collaboration_diagnostic',
  'collaboration-diagnostic',
  'Collaboration Diagnostic',
  '24 statements rated 1-5, six sections, reported for the group',
  'live',
  24, 6, 1, 5
)
ON CONFLICT(id) DO UPDATE SET
  slug = excluded.slug, name = excluded.name, description = excluded.description,
  status = excluded.status, question_count = excluded.question_count,
  per_page = excluded.per_page, min_answer = excluded.min_answer, max_answer = excluded.max_answer;

-- The statements, verbatim from Collaboration_Diagnostic_Master.docx. The
-- trailing comment on each row is the scoring key's own direction for that
-- item, carried here as documentation only -- src/shared/collab.ts is what the
-- engine reads.
INSERT INTO questions (assessment_id, no, text) VALUES
  ('asm_collaboration_diagnostic', 1, 'When my department depends on other teams, we have clear shared agreements and enough joint authority to deliver together.'),  -- D · structure
  ('asm_collaboration_diagnostic', 2, 'When another department is late, it directly stops my team from delivering our own results.'),  -- R · structure
  ('asm_collaboration_diagnostic', 3, 'The way our performance is measured pushes me to protect my own department''s targets, even when this creates problems for another department.'),  -- R · structure
  ('asm_collaboration_diagnostic', 4, 'Work often comes to a standstill because two departments that must work together have completely different priorities.'),  -- R · structure
  ('asm_collaboration_diagnostic', 5, 'When several departments work on a project, it is clear who has the final say, so decisions do not get stuck.'),  -- D · structure
  ('asm_collaboration_diagnostic', 6, 'Not-Invented-Here: Teams readily adopt proven methods and solutions from other departments, instead of insisting on building their own.'),  -- D · barriers
  ('asm_collaboration_diagnostic', 7, 'Hoarding: Important information or expertise is held tightly within certain departments, so other teams are left working with incomplete information.'),  -- R · barriers
  ('asm_collaboration_diagnostic', 8, 'Search: We lose a lot of time simply trying to find the right person or expert in another department to solve an urgent problem.'),  -- R · barriers
  ('asm_collaboration_diagnostic', 9, 'Transfer: We often have to redo work because the handover from one department to the next is poorly managed.'),  -- R · barriers
  ('asm_collaboration_diagnostic', 10, 'To avoid difficult discussions, leaders often pretend to agree in the meeting, but voice their disagreement later, outside the room.'),  -- R · trust
  ('asm_collaboration_diagnostic', 11, 'When a mistake happens, our first reaction is to fix the real cause, rather than to find someone to blame.'),  -- D · trust
  ('asm_collaboration_diagnostic', 12, 'In meetings with other departments, leaders hold back or carefully filter information to protect themselves or their teams.'),  -- R · trust
  ('asm_collaboration_diagnostic', 13, 'People feel safe asking other departments for help, without worrying that it will be seen as a sign of weakness.'),  -- D · trust
  ('asm_collaboration_diagnostic', 14, 'When two departments disagree, work comes to a stop until a senior executive steps in to settle it.'),  -- R · power
  ('asm_collaboration_diagnostic', 15, 'In joint meetings, a leader''s rank or influence in the company regularly wins over data, facts, or logic.'),  -- R · power
  ('asm_collaboration_diagnostic', 16, 'Even junior or less powerful leaders speak up when they see a decision that could put company goals at risk.'),  -- D · power
  ('asm_collaboration_diagnostic', 17, 'We depend heavily on formal, written escalation rules because relationships between colleagues are not strong enough to handle disagreements.'),  -- R · power
  ('asm_collaboration_diagnostic', 18, 'The strong pressure for “zero errors” makes leaders hide early risks or bad news until they turn into a full crisis.'),  -- R · pressure
  ('asm_collaboration_diagnostic', 19, 'Tight production and delivery deadlines regularly force us to cut corners on teamwork and alignment across departments.'),  -- R · pressure
  ('asm_collaboration_diagnostic', 20, 'At times, departments use strict regulatory and compliance rules as an excuse to delay or block joint efforts.'),  -- R · pressure
  ('asm_collaboration_diagnostic', 21, 'Even under pressure to follow rules and procedures, leaders stay focused on solving problems between departments.'),  -- D · pressure
  ('asm_collaboration_diagnostic', 22, 'Senior executives consistently set an example of working across departments, even during times of high pressure.'),  -- D · levers
  ('asm_collaboration_diagnostic', 23, 'Our leaders share one clear, common view of what success looks like for the whole company, above their own department targets.'),  -- D · levers
  ('asm_collaboration_diagnostic', 24, 'We clearly reward and promote leaders who help other departments succeed — not only those who meet their own department''s targets.')  -- D · levers

ON CONFLICT(assessment_id, no) DO UPDATE SET text = excluded.text;
