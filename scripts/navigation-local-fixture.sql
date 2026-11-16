-- Synthetic navigation fixture linked to the existing local Police test incident.
-- It references an existing local test image; no pre-existing record is changed.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM incidents WHERE id='inc_f9bd21f0' AND data->>'investigatingOfficerId'='u_police')
     OR NOT EXISTS (SELECT 1 FROM app_state, LATERAL jsonb_array_elements(data->'videoEvidence') item
                    WHERE key='operational' AND item->>'id'='evd_0929ef60') THEN
    RAISE EXCEPTION 'Required local synthetic incident or image fixture is missing';
  END IF;
END $$;
UPDATE app_state SET data = jsonb_set(data, '{videoEvidence}',
  COALESCE(data->'videoEvidence', '[]'::jsonb) || jsonb_build_array(
    (SELECT item || jsonb_build_object(
      'id', 'evd_nav_fixture_20261022', 'evidenceId', 'evd_nav_fixture_20261022',
      'fileName', 'synthetic-navigation-fixture.jpg', 'isDemo', true,
      'notes', 'Synthetic local navigation verification fixture',
      'linkedIncidentId', 'inc_f9bd21f0', 'linkedReportId', NULL,
      'chainOfCustody', '[]'::jsonb)
     FROM jsonb_array_elements(data->'videoEvidence') item
     WHERE item->>'id' = 'evd_0929ef60')
  ), true), updated_at = now()
WHERE key='operational'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(data->'videoEvidence') item WHERE item->>'id' = 'evd_0929ef60')
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(data->'videoEvidence') item WHERE item->>'id' = 'evd_nav_fixture_20261022');

INSERT INTO evidence_references(id) VALUES ('evd_nav_fixture_20261022') ON CONFLICT (id) DO NOTHING;
INSERT INTO evidence_image_analyses (id,evidence_id,input_sha256,created_at,data)
VALUES ('analysis_nav_fixture_20261022','evd_nav_fixture_20261022',repeat('a',64),now(),
  jsonb_build_object('id','analysis_nav_fixture_20261022','evidenceId','evd_nav_fixture_20261022',
    'model','synthetic-fixture','status','COMPLETED','detections',jsonb_build_array(), 'synthetic',true))
ON CONFLICT (id) DO NOTHING;
INSERT INTO ai_observations (id,camera_id,status,captured_at,processed_at,created_at,data,source_type,source_id,evidence_id,analysis_id)
VALUES ('obs_nav_fixture_20261022',NULL,'PENDING_REVIEW',now(),now(),now(),
  jsonb_build_object('id','obs_nav_fixture_20261022','cameraId',NULL,'status','PENDING_REVIEW',
    'sourceType','evidence_image','source','evidence_image','sourceId','evd_nav_fixture_20261022',
    'evidenceId','evd_nav_fixture_20261022','linkedEvidenceId','evd_nav_fixture_20261022',
    'linkedIncidentId','inc_f9bd21f0','analysisId','analysis_nav_fixture_20261022',
    'model','synthetic-fixture','detections',jsonb_build_array(),'synthetic',true,
    'createdAt',now(),'capturedAt',now(),'processedAt',now(),'humanVerificationRequired',true),
  'evidence_image','evd_nav_fixture_20261022','evd_nav_fixture_20261022','analysis_nav_fixture_20261022')
ON CONFLICT (id) DO NOTHING;
INSERT INTO missing_persons (id,status,created_by,created_at,updated_at,data)
SELECT 'report_nav_fixture_20261022','submitted_for_review','u_citizen',now(),now(),
  data || jsonb_build_object('id','report_nav_fixture_20261022','createdBy','u_citizen',
    'name','Synthetic navigation fixture','status','submitted_for_review',
    'createdAt',now(),'updatedAt',now(),'synthetic',true)
FROM missing_persons WHERE id='mo_5c3cd452'
ON CONFLICT (id) DO NOTHING;
INSERT INTO notifications (id,dedupe_key,type,title,message,severity,entity_type,entity_id,source,recipient_roles,created_at,data)
VALUES ('ntf_nav_missing_20261022','nav_missing_20261022','incident_unassigned',
  'Synthetic missing-target fixture','Synthetic local verification record','INFO','incident',
  'incident_nav_missing_20261022','Navigation fixture',ARRAY['Admin','Police Officer'],now(),
  jsonb_build_object('synthetic',true))
ON CONFLICT (id) DO NOTHING;
INSERT INTO notifications (id,dedupe_key,type,title,message,severity,entity_type,entity_id,source,recipient_roles,created_at,data)
VALUES
 ('ntf_nav_camera_20261022','nav_camera_20261022','camera_test', 'Synthetic camera navigation fixture','Local verification only','INFO','camera','cam_c05','Navigation fixture',ARRAY['Admin','Police Officer'],now(),jsonb_build_object('synthetic',true)),
 ('ntf_nav_evidence_20261022','nav_evidence_20261022','evidence_test', 'Synthetic evidence navigation fixture','Local verification only','INFO','evidence','evd_nav_fixture_20261022','Navigation fixture',ARRAY['Admin','Police Officer'],now(),jsonb_build_object('synthetic',true))
ON CONFLICT (id) DO NOTHING;
COMMIT;
