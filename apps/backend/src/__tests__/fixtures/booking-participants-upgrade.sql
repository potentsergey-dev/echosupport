BEGIN;
CREATE SCHEMA r02_upgrade_test;
SET LOCAL search_path TO r02_upgrade_test;
CREATE TABLE "Agent" (id TEXT PRIMARY KEY);
CREATE TABLE "BusinessHours" ("agentId" TEXT PRIMARY KEY);
CREATE TABLE "Specialist" (id TEXT PRIMARY KEY);
CREATE TABLE "Service" (id TEXT PRIMARY KEY, "isGroup" BOOLEAN, capacity INTEGER);
CREATE TABLE "SpecialistWorkingHours" (id TEXT PRIMARY KEY, "specialistId" TEXT);
CREATE TABLE "Appointment" (id TEXT PRIMARY KEY, "tenantId" TEXT, "specialistId" TEXT, "serviceId" TEXT,
 notes TEXT, status TEXT, "startsAt" TIMESTAMP, "endsAt" TIMESTAMP);
INSERT INTO "Specialist" VALUES ('s');
INSERT INTO "Service" VALUES ('group',true,4),('individual',false,1);
INSERT INTO "Appointment" VALUES
 ('valid','t','s','group','Group participants: 3','CANCELLED','2099-12-01 09:00','2099-12-01 10:00'),
 ('duplicate','t','s','group',E'Group participants: 2\nGroup participants: 3','CANCELLED','2099-12-01 09:00','2099-12-01 10:00'),
 ('zero','t','s','group','Group participants: 0','CANCELLED','2099-12-01 09:00','2099-12-01 10:00'),
 ('suffix','t','s','group','Group participants: 2 unknown','CANCELLED','2099-12-01 09:00','2099-12-01 10:00'),
 ('overflow','t','s','group','Group participants: 99999999999999','CANCELLED','2099-12-01 09:00','2099-12-01 10:00'),
 ('missing','t','s','group',NULL,'CANCELLED','2099-12-01 09:00','2099-12-01 10:00'),
 ('individual','t','s','individual',NULL,'CANCELLED','2099-12-01 09:00','2099-12-01 10:00');
-- MIGRATION_HERE

DO $$ BEGIN
 IF (SELECT "participantCount" FROM "Appointment" WHERE id='valid')<>3 THEN RAISE EXCEPTION 'valid backfill failed'; END IF;
 IF (SELECT "participantCount" FROM "Appointment" WHERE id='individual')<>1 THEN RAISE EXCEPTION 'individual backfill failed'; END IF;
 IF (SELECT count(*) FROM "Appointment" WHERE "participantCount" IS NULL AND "participantCountReviewReason" IS NOT NULL)<>5 THEN RAISE EXCEPTION 'review backfill failed'; END IF;
END $$;
-- Old revision omits new columns and later replaces the notes.
INSERT INTO "Appointment"(id,"tenantId","specialistId","serviceId",notes,status,"startsAt","endsAt")
 VALUES ('old-write','t','s','group','Group participants: 2','PENDING','2099-12-02 09:00','2099-12-02 10:00');
UPDATE "Appointment" SET notes='old revision replaced the text' WHERE id='old-write';
DO $$ BEGIN
 IF (SELECT "participantCount" FROM "Appointment" WHERE id='old-write')<>2 OR
    (SELECT notes FROM "Appointment" WHERE id='old-write') NOT LIKE 'Group participants: 2%' THEN RAISE EXCEPTION 'old revision lost seats'; END IF;
 BEGIN
   UPDATE "Appointment" SET "participantCount"=0 WHERE id='valid';
   RAISE EXCEPTION 'zero accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
   UPDATE "Appointment" SET "participantCount"=NULL,"participantCountReviewReason"=NULL WHERE id='valid';
   -- trigger marks unresolved rather than accepting a silent default.
   IF (SELECT "participantCountReviewReason" FROM "Appointment" WHERE id='valid') IS NULL THEN RAISE EXCEPTION 'null count not marked'; END IF;
 END;
 BEGIN
   INSERT INTO "Appointment"(id,"tenantId","specialistId","serviceId",notes,status,"startsAt","endsAt")
     VALUES ('overbook','t','s','group','Group participants: 3','PENDING','2099-12-02 09:00','2099-12-02 10:00');
   RAISE EXCEPTION 'legacy overbooking accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'SLOT_FULL' THEN RAISE; END IF; END;
END $$;
ROLLBACK;
