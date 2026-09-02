'use strict';

// Garante a regra no ponto comum a todos os fluxos de escrita: a própria base
// de dados. A limpeza conserva o serviço que já surge primeiro na rota
// (sortIndex mais baixo) e desmarca apenas os duplicados posteriores.
const CLEAN_DUPLICATES_SQL = `
  WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY portal_id, date
             ORDER BY sortIndex ASC NULLS LAST, created_at ASC NULLS LAST, id ASC
           ) AS route_position
      FROM appointments
     WHERE first_of_day IS TRUE
       AND portal_id IS NOT NULL
       AND date IS NOT NULL
  )
  UPDATE appointments a
     SET first_of_day = FALSE,
         updated_at = NOW()
    FROM ranked r
   WHERE a.id = r.id
     AND r.route_position > 1
`;

// O advisory lock serializa duas gravações simultâneas para a mesma
// agenda/data. A última escolha explícita passa a ser a primeira e o registo
// anterior é desmarcado dentro da mesma instrução/transação.
const CREATE_TRIGGER_FUNCTION_SQL = `
  CREATE OR REPLACE FUNCTION appointments_enforce_single_first_of_day_v1()
  RETURNS TRIGGER AS $$
  BEGIN
    IF NEW.first_of_day IS TRUE
       AND NEW.portal_id IS NOT NULL
       AND NEW.date IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(NEW.portal_id, hashtext(NEW.date::text));

      UPDATE appointments
         SET first_of_day = FALSE,
             updated_at = NOW()
       WHERE portal_id = NEW.portal_id
         AND date = NEW.date
         AND first_of_day IS TRUE
         AND id IS DISTINCT FROM NEW.id;
    END IF;

    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql
`;

const CREATE_TRIGGER_SQL = `
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
        FROM pg_trigger
       WHERE tgrelid = 'appointments'::regclass
         AND tgname = 'appointments_single_first_of_day_v1'
         AND NOT tgisinternal
    ) THEN
      CREATE TRIGGER appointments_single_first_of_day_v1
      BEFORE INSERT OR UPDATE OF first_of_day, date, portal_id
      ON appointments
      FOR EACH ROW
      EXECUTE FUNCTION appointments_enforce_single_first_of_day_v1();
    END IF;
  END
  $$
`;

// Defesa adicional: mesmo uma escrita futura que não passe pela API fica
// impedida de deixar dois primeiros serviços no mesmo dia da mesma agenda.
const CREATE_UNIQUE_INDEX_SQL = `
  CREATE UNIQUE INDEX IF NOT EXISTS appointments_one_first_per_portal_day_uidx
      ON appointments (portal_id, date)
   WHERE first_of_day IS TRUE
     AND portal_id IS NOT NULL
     AND date IS NOT NULL
`;

async function ensureSingleFirstOfDay(db) {
  await db.query(CLEAN_DUPLICATES_SQL);
  await db.query(CREATE_TRIGGER_FUNCTION_SQL);
  await db.query(CREATE_TRIGGER_SQL);
  await db.query(CREATE_UNIQUE_INDEX_SQL);
}

module.exports = {
  CLEAN_DUPLICATES_SQL,
  CREATE_TRIGGER_FUNCTION_SQL,
  CREATE_TRIGGER_SQL,
  CREATE_UNIQUE_INDEX_SQL,
  ensureSingleFirstOfDay
};
