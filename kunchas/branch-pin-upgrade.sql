ALTER TABLE branches ADD COLUMN post_code TEXT;
ALTER TABLE branches ADD COLUMN pin_code TEXT;

UPDATE branches SET post_code = '2000', pin_code = '2000' WHERE id = 'branch-city';
UPDATE branches SET post_code = '2150', pin_code = '2150' WHERE id = 'branch-parramatta';
UPDATE branches SET post_code = '2170', pin_code = '2170' WHERE id = 'branch-liverpool';
UPDATE branches SET post_code = '2148', pin_code = '2148' WHERE id = 'branch-blacktown';
UPDATE branches SET post_code = '2220', pin_code = '2220' WHERE id = 'branch-hurstville';
