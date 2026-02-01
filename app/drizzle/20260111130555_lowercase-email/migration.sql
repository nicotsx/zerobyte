-- Custom SQL migration file, put your code below! --
UPDATE users_table SET email = LOWER(TRIM(email));
