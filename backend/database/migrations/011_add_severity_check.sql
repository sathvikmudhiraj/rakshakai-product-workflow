-- Add check constraint for severity column on incidents table
-- First update any NULL or invalid severity values to 'MEDIUM'
UPDATE incidents SET severity = 'MEDIUM' WHERE severity IS NULL OR severity NOT IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- Add the check constraint
ALTER TABLE incidents ADD CONSTRAINT incidents_severity_check
    CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW'));