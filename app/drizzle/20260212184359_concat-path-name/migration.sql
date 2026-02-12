UPDATE `repositories_table`
SET
	`config` = json_set(
		`config`,
		'$.path',
		CASE
			WHEN json_extract(`config`, '$.path') IS NULL OR trim(json_extract(`config`, '$.path')) = ''
				THEN '/var/lib/zerobyte/repositories/' || json_extract(`config`, '$.name')
			ELSE rtrim(json_extract(`config`, '$.path'), '/') || '/' || json_extract(`config`, '$.name')
		END
	),
	`updated_at` = (unixepoch() * 1000)
WHERE `type` = 'local'
	AND json_extract(`config`, '$.name') IS NOT NULL
	AND trim(json_extract(`config`, '$.name')) <> ''
	AND (
		json_extract(`config`, '$.path') IS NULL
		OR trim(json_extract(`config`, '$.path')) = ''
		OR substr(
			rtrim(json_extract(`config`, '$.path'), '/'),
			-length('/' || json_extract(`config`, '$.name'))
		) != '/' || json_extract(`config`, '$.name')
	);
