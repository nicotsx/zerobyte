UPDATE users_table SET role = 'admin' WHERE role IS NULL OR role = '';
