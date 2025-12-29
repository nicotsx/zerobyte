-- Migrate local imported repository paths to include the repository name
-- Previously, the path and name were concatenated at runtime. Now the path should be the full path.

UPDATE `repositories_table`
SET `config` = json_set(`config`, '$.path', rtrim(json_extract(`config`, '$.path'), '/') || '/' || json_extract(`config`, '$.name')),
    `updated_at` = (unixepoch() * 1000)
WHERE `type` = 'local'
  AND json_extract(`config`, '$.isExistingRepository') = true
  AND json_extract(`config`, '$.path') IS NOT NULL
  AND json_extract(`config`, '$.name') IS NOT NULL;
