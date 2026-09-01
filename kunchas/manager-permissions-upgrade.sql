ALTER TABLE manager_branch_assignments
ADD COLUMN permissions TEXT NOT NULL DEFAULT '["dashboard","customers","staff","roster","services","products","inventory","reports","bookings","closing"]';
