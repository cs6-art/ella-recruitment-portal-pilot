UPDATE "portal_settings"
SET "value" = 'McPrint', "updated_at" = now()
WHERE "key" = 'Organization_Display_Name'
  AND lower(trim("value")) = 'mcprint';
