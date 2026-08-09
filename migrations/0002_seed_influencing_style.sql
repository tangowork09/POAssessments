-- Seed data — Influencing Style Inventory (40 statements, 10 styles).
-- Question text is the copy in data/influencing_style.questions.json, which is
-- the extract from the client source workbook. Keep the two in step.

INSERT INTO assessments (id, slug, name, description, status, question_count, per_page, min_answer, max_answer) VALUES
  ('asm_influencing_style', 'influencing-style', 'Influencing Style Inventory', '10 styles - push/pull', 'live', 40, 8, 0, 5);

INSERT INTO assessments (id, slug, name, description, status, question_count) VALUES
  ('asm_ta_ego_states', 'ta-ego-states', 'TA Ego States Scale', 'Transactional analysis', 'planned', 66),
  ('asm_motivation_need', 'motivation-need', 'Motivation Need Assessment', 'Need profile - 6 drivers', 'planned', 69);

INSERT INTO questions (assessment_id, no, text) VALUES
  ('asm_influencing_style', 1, 'I exert pressure in order to achieve my objectives'),
  ('asm_influencing_style', 2, 'I get others to support my projects by offering to help them in some way.'),
  ('asm_influencing_style', 3, 'I bring others to see the exciting possibilities in a situation.'),
  ('asm_influencing_style', 4, 'I listen carefully when people express views which are different from mine.'),
  ('asm_influencing_style', 5, 'I present strong arguments for the proposals I favour.'),
  ('asm_influencing_style', 6, 'I am quick to make my wishes and desires known to others.'),
  ('asm_influencing_style', 7, 'I verbalise standards that I think others ought to meet.'),
  ('asm_influencing_style', 8, 'I am open with information as opposed to secretive.'),
  ('asm_influencing_style', 9, 'I make sure my optimism and enthusiasms are contagious.'),
  ('asm_influencing_style', 10, 'I smooth over disagreements i.e. pour oil on troubled waters.'),
  ('asm_influencing_style', 11, 'I help others see the goals and values they have in common.'),
  ('asm_influencing_style', 12, 'I tell people directly when they don''t meet my expectations or requirements.'),
  ('asm_influencing_style', 13, 'I use the power of my position to get others to go along.'),
  ('asm_influencing_style', 14, 'I hold to my position until others show willingness to compromise or make concessions.'),
  ('asm_influencing_style', 15, 'I use praise selectively to get others to change or improve their performance.'),
  ('asm_influencing_style', 16, 'My belief in others helps them to feel stronger and more confident.'),
  ('asm_influencing_style', 17, 'I use humour or anecdotes effectively to help make a point.'),
  ('asm_influencing_style', 18, 'I put forward proposals and suggestions that I feel have merit even if they are unpopular.'),
  ('asm_influencing_style', 19, 'I am open about my motives and intentions.'),
  ('asm_influencing_style', 20, 'I work with others to help get the best solution to the problems.'),
  ('asm_influencing_style', 21, 'I am prepared to make a fuss to get things done.'),
  ('asm_influencing_style', 22, 'I use rational argument to make my points.'),
  ('asm_influencing_style', 23, 'I help other people to solve their own problems.'),
  ('asm_influencing_style', 24, 'I have a clear code of principles that I communicate to others.'),
  ('asm_influencing_style', 25, 'I am able to communicate what needs to be done to create a better future.'),
  ('asm_influencing_style', 26, 'I check my understanding of what others have said.'),
  ('asm_influencing_style', 27, 'I defuse conflict situations by the use of humour or an appropriate change of subject.'),
  ('asm_influencing_style', 28, 'I challenge ideas or suggestions I disagree with or have questions about.'),
  ('asm_influencing_style', 29, 'I exchange favours in order to get things accomplished.'),
  ('asm_influencing_style', 30, 'I present my ideas with vigour.'),
  ('asm_influencing_style', 31, 'I exert pressure on people in order to achieve my objectives.'),
  ('asm_influencing_style', 32, 'I take steps to acquire formal authority to enable me to implement my plans.'),
  ('asm_influencing_style', 33, 'I take great care to educate others so that they can understand what I am thinking.'),
  ('asm_influencing_style', 34, 'I bargain to get what I want.'),
  ('asm_influencing_style', 35, 'I strive to inspire people by the way I present ideas.'),
  ('asm_influencing_style', 36, 'If individuals are not participating I go out of my way to involve them.'),
  ('asm_influencing_style', 37, 'I am quick to state my wishes to others.'),
  ('asm_influencing_style', 38, 'I use my personality and charm to advantage.'),
  ('asm_influencing_style', 39, 'I try to find common ground with others.'),
  ('asm_influencing_style', 40, 'I work steadily to build trust into relationships to enable effective joint working.');

INSERT INTO scoring_styles (assessment_id, key, name, side, sort_order, items) VALUES
  ('asm_influencing_style', 'force', 'Force', 'push', 0, '[1,13,21,31]'),
  ('asm_influencing_style', 'rules', 'Rules & Standards', 'push', 1, '[7,12,24,32]'),
  ('asm_influencing_style', 'exchange', 'Exchange', 'push', 2, '[2,14,29,34]'),
  ('asm_influencing_style', 'persuasion', 'Persuasion', 'push', 3, '[5,18,22,33]'),
  ('asm_influencing_style', 'assertion', 'Assertion', 'push', 4, '[6,19,28,37]'),
  ('asm_influencing_style', 'magnetism', 'Personal Magnetism', 'pull', 5, '[9,17,30,38]'),
  ('asm_influencing_style', 'visioning', 'Visioning', 'pull', 6, '[3,11,25,35]'),
  ('asm_influencing_style', 'bridging', 'Bridging / Consensus', 'pull', 7, '[4,16,26,39]'),
  ('asm_influencing_style', 'environmental', 'Environmental', 'pull', 8, '[10,15,27,36]'),
  ('asm_influencing_style', 'joint', 'Joint Problem Solving', 'pull', 9, '[8,20,23,40]');

-- Platform defaults. Branding and the daily send cap are editable in the admin console.
INSERT INTO settings (key, value) VALUES
  ('branding.company_name', 'Assessment Platform'),
  ('branding.accent_color', '#1A4FD6'),
  ('branding.logo_data_url', ''),
  ('branding.support_email', ''),
  ('mail.daily_send_cap', '50'),
  ('mail.attach_pdf', 'true'),
  ('theme.active', 'enterprise');
