UPDATE "portal_settings"
SET "value" = 'McLink', "updated_at" = now()
WHERE "organization_id" = '00000000-0000-4000-8000-000000000001'
  AND "key" = 'Organization_Display_Name'
  AND lower(trim("value")) = 'mcprint';
