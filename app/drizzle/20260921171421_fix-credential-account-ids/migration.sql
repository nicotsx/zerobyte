UPDATE `account`
SET `account_id` = `user_id`, `updated_at` = unixepoch() * 1000
WHERE `provider_id` = 'credential' AND `account_id` <> `user_id`
	AND NOT EXISTS (
		SELECT 1 FROM `account` AS `other`
		WHERE `other`.`user_id` = `account`.`user_id`
			AND `other`.`provider_id` = 'credential'
			AND `other`.`id` <> `account`.`id`
	);
