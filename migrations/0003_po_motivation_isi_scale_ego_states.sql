-- Client update batch: PO Motivation branding, the ISI 0-4 scale correction,
-- and the Ego States Scale going live.
--
-- 1. Branding defaults become PO Motivation. The logo itself is not stored
--    here: it lives in the bundle (src/shared/brand-logo.ts) and is what an
--    empty 'branding.logo_data_url' resolves to, so a tenant upload still
--    overrides it and clearing an upload restores the house mark.
--
-- 2. The Influencing Style Inventory is rated 0-4, not 0-5. The published
--    anchors are 0 'I never do it' through 4 'I always do this', which puts a
--    style out of 16 and a side out of 80. Development responses recorded on
--    the old 0-5 scale are not convertible, so they are cleared: there is no
--    production data.
--
-- 3. The Ego States Scale (66 statements, rated 0-6, six ego states scored by
--    column) goes live. Statement n belongs to state ((n-1) mod 6) + 1.

-- --------------------------------------------------------------- 1. branding
UPDATE settings SET value = 'PO Motivation', updated_at = datetime('now')
 WHERE key = 'branding.company_name' AND value = 'Assessment Platform';

UPDATE settings SET value = '#0B6FB4', updated_at = datetime('now')
 WHERE key = 'branding.accent_color' AND value = '#1A4FD6';

-- The house logo is the fallback for an empty value; nothing to store.
INSERT INTO settings (key, value) VALUES ('branding.logo_data_url', '')
  ON CONFLICT(key) DO NOTHING;

-- --------------------------------------------------------- 2. ISI 0-4 scale
UPDATE assessments
   SET max_answer = 4,
       description = '10 styles - push/pull, rated 0-4'
 WHERE id = 'asm_influencing_style';

-- Development answers on the retired 0-5 scale cannot be rescaled honestly.
DELETE FROM reports WHERE response_id IN (
  SELECT r.id FROM responses r
   WHERE r.assessment_id = 'asm_influencing_style'
     AND EXISTS (SELECT 1 FROM answers a WHERE a.response_id = r.id AND a.value > 4)
);
DELETE FROM answers WHERE response_id IN (
  SELECT id FROM responses WHERE assessment_id = 'asm_influencing_style'
) AND value > 4;
UPDATE responses
   SET status = CASE WHEN answered_count > 0 THEN 'in_progress' ELSE 'invited' END,
       completed_at = NULL,
       answered_count = (SELECT COUNT(*) FROM answers a WHERE a.response_id = responses.id)
 WHERE assessment_id = 'asm_influencing_style'
   AND NOT EXISTS (SELECT 1 FROM reports rp WHERE rp.response_id = responses.id);

-- ------------------------------------------------------- 3. Ego States Scale
UPDATE assessments
   SET name           = 'Ego States Scale',
       slug           = 'ta-ego-states',
       description    = 'Transactional analysis - six ego states, rated 0-6',
       status         = 'live',
       question_count = 66,
       per_page       = 8,
       min_answer     = 0,
       max_answer     = 6
 WHERE id = 'asm_ta_ego_states';

DELETE FROM questions WHERE assessment_id = 'asm_ta_ego_states';
INSERT INTO questions (assessment_id, no, text) VALUES
  ('asm_ta_ego_states', 1, 'I am strict with myself as well as others.'),
  ('asm_ta_ego_states', 2, 'I express my concern with gentleness.'),
  ('asm_ta_ego_states', 3, 'I easily notice changes in the expression on people’s faces.'),
  ('asm_ta_ego_states', 4, 'I guess at the hidden meanings in what people say.'),
  ('asm_ta_ego_states', 5, 'I express my feelings spontaneously.'),
  ('asm_ta_ego_states', 6, 'I rebel against injustice.'),
  ('asm_ta_ego_states', 7, 'Children should do what they are told to without asking reasons.'),
  ('asm_ta_ego_states', 8, 'I have a healing influence.'),
  ('asm_ta_ego_states', 9, 'I can remember previous conversations and events in detail.'),
  ('asm_ta_ego_states', 10, 'I keep past experiences clearly in mind when making current decisions.'),
  ('asm_ta_ego_states', 11, 'I have warm loving relationships.'),
  ('asm_ta_ego_states', 12, 'I am openly or silently defiant.'),
  ('asm_ta_ego_states', 13, 'I decide on the basis of principles.'),
  ('asm_ta_ego_states', 14, 'I give my body the nourishment it requires.'),
  ('asm_ta_ego_states', 15, 'I have an effective listening power.'),
  ('asm_ta_ego_states', 16, 'I like organizing and reorganizing data into schemes.'),
  ('asm_ta_ego_states', 17, 'I often hear or tell funny jokes.'),
  ('asm_ta_ego_states', 18, 'I dislike taking orders.'),
  ('asm_ta_ego_states', 19, 'I get upset with those who do not follow my instructions.'),
  ('asm_ta_ego_states', 20, 'I am affectionate in giving attention to others.'),
  ('asm_ta_ego_states', 21, 'I pay attention to the way people respond to me.'),
  ('asm_ta_ego_states', 22, 'I think of various possible solutions to a problem.'),
  ('asm_ta_ego_states', 23, 'I am satisfied with myself.'),
  ('asm_ta_ego_states', 24, 'The way I survive is by being independent.'),
  ('asm_ta_ego_states', 25, 'I criticize my own behaviour.'),
  ('asm_ta_ego_states', 26, 'I have a talent of comforting those in distress.'),
  ('asm_ta_ego_states', 27, 'I take time to collect information.'),
  ('asm_ta_ego_states', 28, 'I make intellectual correlations easily.'),
  ('asm_ta_ego_states', 29, 'I have a good share of pleasure of life.'),
  ('asm_ta_ego_states', 30, 'I challenge those who are dominating.'),
  ('asm_ta_ego_states', 31, 'I think I am right in an argument.'),
  ('asm_ta_ego_states', 32, 'Others feel I support them.'),
  ('asm_ta_ego_states', 33, 'I take decisions smoothly'),
  ('asm_ta_ego_states', 34, 'In a crisis I have several options.'),
  ('asm_ta_ego_states', 35, 'I have a full tank of positive strokes.'),
  ('asm_ta_ego_states', 36, 'I get hurt easily.'),
  ('asm_ta_ego_states', 37, 'I know best what is good for others.'),
  ('asm_ta_ego_states', 38, 'I help others to enjoy themselves.'),
  ('asm_ta_ego_states', 39, 'I do not forget instructions.'),
  ('asm_ta_ego_states', 40, 'I feel a sense of integration in my being.'),
  ('asm_ta_ego_states', 41, 'I often go to parties, picnics or movies.'),
  ('asm_ta_ego_states', 42, 'I feel inadequate.'),
  ('asm_ta_ego_states', 43, 'Others do not come up to my expectations.'),
  ('asm_ta_ego_states', 44, 'I give warm caring hugs.'),
  ('asm_ta_ego_states', 45, 'I keep my commitments.'),
  ('asm_ta_ego_states', 46, 'I make intuitive assessments.'),
  ('asm_ta_ego_states', 47, 'I make sure my own needs are met first.'),
  ('asm_ta_ego_states', 48, 'I please others rather than myself.'),
  ('asm_ta_ego_states', 49, 'People should take life more seriously.'),
  ('asm_ta_ego_states', 50, 'I nurture children warmly.'),
  ('asm_ta_ego_states', 51, 'I am aware of my own body sensations.'),
  ('asm_ta_ego_states', 52, 'I do several jobs at the same time'),
  ('asm_ta_ego_states', 53, 'I enjoy spending time on imaginative fantasies.'),
  ('asm_ta_ego_states', 54, 'I try hard to meet expectations of others.'),
  ('asm_ta_ego_states', 55, 'I should have achieved more than I have.'),
  ('asm_ta_ego_states', 56, 'People turn to me for help in their time of need.'),
  ('asm_ta_ego_states', 57, 'I can repeat back to people what they have said to me.'),
  ('asm_ta_ego_states', 58, 'I like analyzing wholes in to parts.'),
  ('asm_ta_ego_states', 59, 'I bounce with fun and laughter.'),
  ('asm_ta_ego_states', 60, 'I postpone taking decisions even when I am clear about them.'),
  ('asm_ta_ego_states', 61, 'I prefer to be the one in control.'),
  ('asm_ta_ego_states', 62, 'I care for my own growth and fulfillment.'),
  ('asm_ta_ego_states', 63, 'I can detect differences in the quality of goods.'),
  ('asm_ta_ego_states', 64, 'I experiment with alternative ways of achieving goals.'),
  ('asm_ta_ego_states', 65, 'I spend time in rest and relaxation.'),
  ('asm_ta_ego_states', 66, 'I wait till I am told to do things.');

-- Scored by column: state 1 is statements 1, 7, 13 ... 61, and so on.
-- The names are a DRAFT pending confirmation by the client; they are stored as
-- data so that a rename is a data change, not a deploy.
DELETE FROM scoring_styles WHERE assessment_id = 'asm_ta_ego_states';
INSERT INTO scoring_styles (assessment_id, key, name, side, sort_order, items) VALUES
  ('asm_ta_ego_states', 'cp', 'Critical Parent', 'CP', 0, '[1,7,13,19,25,31,37,43,49,55,61]'),
  ('asm_ta_ego_states', 'np', 'Nurturing Parent', 'NP', 1, '[2,8,14,20,26,32,38,44,50,56,62]'),
  ('asm_ta_ego_states', 'adult_perceiving', 'Adult - Perceiving', 'A-P', 2, '[3,9,15,21,27,33,39,45,51,57,63]'),
  ('asm_ta_ego_states', 'adult_processing', 'Adult - Processing', 'A-Pr', 3, '[4,10,16,22,28,34,40,46,52,58,64]'),
  ('asm_ta_ego_states', 'fc', 'Free Child', 'FC', 4, '[5,11,17,23,29,35,41,47,53,59,65]'),
  ('asm_ta_ego_states', 'rc', 'Rebellious Child', 'RC', 5, '[6,12,18,24,30,36,42,48,54,60,66]');
