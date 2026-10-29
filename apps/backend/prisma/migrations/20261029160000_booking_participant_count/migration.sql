-- Expand migration: legacy readers keep notes; unresolved rows retain their original text.
ALTER TABLE "Appointment" ADD COLUMN "participantCount" INTEGER,
 ADD COLUMN "participantCountReviewReason" TEXT;

CREATE FUNCTION booking_legacy_participants(notes TEXT) RETURNS INTEGER
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE matches TEXT[]; n NUMERIC;
BEGIN
 IF notes IS NULL OR notes !~* 'Group participants:' THEN RETURN NULL; END IF;
 IF (SELECT count(*) FROM regexp_matches(notes, 'Group participants:', 'gi')) <> 1 THEN RETURN NULL; END IF;
 matches := regexp_match(notes, '(?:^|[\r\n])Group participants:[ \t]*([0-9]+)[ \t]*(?:$|[\r\n])', 'i');
 IF matches IS NULL THEN RETURN NULL; END IF;
 n := matches[1]::NUMERIC;
 IF n < 1 OR n > 2147483647 THEN RETURN NULL; END IF;
 RETURN n::INTEGER;
END $$;

UPDATE "Appointment" a SET
 "participantCount" = CASE WHEN a.notes ~* 'Group participants:' THEN CASE
   WHEN booking_legacy_participants(a.notes)=1 OR EXISTS (SELECT 1 FROM "Service" s WHERE s.id=a."serviceId" AND s."isGroup")
   THEN booking_legacy_participants(a.notes) ELSE NULL END
   WHEN EXISTS (SELECT 1 FROM "Service" s WHERE s.id=a."serviceId" AND s."isGroup") THEN NULL ELSE 1 END;
UPDATE "Appointment" SET "participantCountReviewReason"='LEGACY_PARTICIPANTS_UNRESOLVED'
 WHERE "participantCount" IS NULL;
ALTER TABLE "Appointment" ADD CONSTRAINT appointment_participants_valid CHECK (
 ("participantCount" IS NOT NULL AND "participantCount" > 0 AND "participantCountReviewReason" IS NULL) OR
 ("participantCount" IS NULL AND "participantCountReviewReason" IS NOT NULL));

-- The trigger protects old revisions that omit the new columns. It also serializes
-- legacy admission against new application transactions. No automatic retries.
CREATE FUNCTION booking_participants_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE grouped BOOLEAN; limit_seats INTEGER; busy BIGINT; unresolved BOOLEAN; admitting BOOLEAN;
BEGIN
 PERFORM 1 FROM "Specialist" WHERE id=NEW."specialistId" FOR UPDATE;
 SELECT "isGroup", capacity INTO grouped, limit_seats FROM "Service" WHERE id=NEW."serviceId" FOR SHARE;
 grouped := coalesce(grouped,false); limit_seats := coalesce(limit_seats,1);
 IF TG_OP='INSERT' AND NEW."participantCount" IS NULL THEN
   NEW."participantCount" := CASE WHEN NEW.notes ~* 'Group participants:' THEN booking_legacy_participants(NEW.notes)
      WHEN grouped THEN NULL ELSE 1 END;
 END IF;
 IF NEW."participantCount" IS NULL THEN
   NEW."participantCountReviewReason" := 'LEGACY_PARTICIPANTS_UNRESOLVED';
 ELSE
   NEW."participantCountReviewReason" := NULL;
   -- Canonical compatibility text allows old readers to see the authoritative count.
   IF grouped OR NEW.notes ~* 'Group participants:' THEN
     NEW.notes := 'Group participants: ' || NEW."participantCount" ||
       CASE WHEN btrim(regexp_replace(coalesce(NEW.notes,''), 'Group participants:[ \t]*[0-9]+', '', 'gi')) <> ''
       THEN E'\n' || btrim(regexp_replace(coalesce(NEW.notes,''), 'Group participants:[ \t]*[0-9]+', '', 'gi')) ELSE '' END;
   END IF;
 END IF;
 admitting := TG_OP='INSERT';
 IF TG_OP='UPDATE' THEN
   admitting := (OLD.status NOT IN ('PENDING','CONFIRMED') OR
     NEW."startsAt" IS DISTINCT FROM OLD."startsAt" OR NEW."endsAt" IS DISTINCT FROM OLD."endsAt" OR
     (NEW."participantCount" IS DISTINCT FROM OLD."participantCount" AND NOT (OLD."participantCount" IS NULL AND NEW."participantCount" IS NOT NULL)) OR NEW."serviceId" IS DISTINCT FROM OLD."serviceId" OR
     NEW."specialistId" IS DISTINCT FROM OLD."specialistId");
 END IF;
 IF admitting AND NEW.status IN ('PENDING','CONFIRMED') THEN
   IF NEW."participantCount" IS NULL THEN RAISE EXCEPTION 'BOOKING_PARTICIPANTS_REVIEW'; END IF;
   IF NOT grouped AND NEW."participantCount" <> 1 THEN RAISE EXCEPTION 'BOOKING_INVALID_PARTICIPANTS'; END IF;
   IF EXISTS (SELECT 1 FROM "Appointment" a WHERE a.id<>NEW.id AND a."specialistId"=NEW."specialistId"
      AND a.status IN ('PENDING','CONFIRMED') AND a."startsAt"<NEW."endsAt" AND a."endsAt">NEW."startsAt"
      AND (NOT grouped OR a."serviceId" IS DISTINCT FROM NEW."serviceId" OR a."startsAt"<>NEW."startsAt" OR a."endsAt"<>NEW."endsAt"))
   THEN RAISE EXCEPTION 'SLOT_TAKEN'; END IF;
   SELECT coalesce(sum(a."participantCount"),0), coalesce(bool_or(a."participantCount" IS NULL),false)
     INTO busy, unresolved FROM "Appointment" a WHERE a.id<>NEW.id AND a."specialistId"=NEW."specialistId"
     AND a.status IN ('PENDING','CONFIRMED') AND a."startsAt"<NEW."endsAt" AND a."endsAt">NEW."startsAt";
   IF unresolved THEN RAISE EXCEPTION 'BOOKING_PARTICIPANTS_REVIEW'; END IF;
   IF busy + NEW."participantCount" > greatest(limit_seats,1) THEN RAISE EXCEPTION 'SLOT_FULL'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER booking_participants_guard BEFORE INSERT OR UPDATE ON "Appointment"
 FOR EACH ROW EXECUTE FUNCTION booking_participants_guard();

ALTER TABLE "Appointment" ADD COLUMN "bookingRequestKey" TEXT, ADD COLUMN "bookingRequestHash" TEXT;
CREATE UNIQUE INDEX "Appointment_tenantId_bookingRequestKey_key" ON "Appointment"("tenantId", "bookingRequestKey");

CREATE FUNCTION booking_hours_lock() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
   PERFORM 1 FROM "Specialist" WHERE id=OLD."specialistId" FOR UPDATE; RETURN OLD;
 END IF;
 PERFORM 1 FROM "Specialist" WHERE id=NEW."specialistId" FOR UPDATE; RETURN NEW;
END $$;
CREATE TRIGGER booking_hours_lock BEFORE INSERT OR UPDATE OR DELETE ON "SpecialistWorkingHours"
 FOR EACH ROW EXECUTE FUNCTION booking_hours_lock();

CREATE FUNCTION booking_service_capacity_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.capacity IS DISTINCT FROM OLD.capacity OR NEW."isGroup" IS DISTINCT FROM OLD."isGroup" THEN
   IF EXISTS (SELECT 1 FROM "Appointment" WHERE "serviceId"=NEW.id AND status IN ('PENDING','CONFIRMED')
      GROUP BY "specialistId", "startsAt", "endsAt"
      HAVING bool_or("participantCount" IS NULL) OR sum("participantCount") > CASE WHEN NEW."isGroup" THEN greatest(NEW.capacity,1) ELSE 1 END)
   THEN RAISE EXCEPTION 'BOOKING_CAPACITY_BELOW_OCCUPANCY'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER booking_service_capacity_guard BEFORE UPDATE ON "Service"
 FOR EACH ROW EXECUTE FUNCTION booking_service_capacity_guard();

-- Serialize timezone upserts, including the first BusinessHours row, with admission.
CREATE FUNCTION booking_business_hours_lock() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
   PERFORM 1 FROM "Agent" WHERE id=OLD."agentId" FOR UPDATE; RETURN OLD;
 END IF;
 PERFORM 1 FROM "Agent" WHERE id=NEW."agentId" FOR UPDATE; RETURN NEW;
END $$;
CREATE TRIGGER booking_business_hours_lock BEFORE INSERT OR UPDATE OR DELETE ON "BusinessHours"
 FOR EACH ROW EXECUTE FUNCTION booking_business_hours_lock();
