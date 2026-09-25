-- Apply once. Existing duplicates are preserved for manual review; new duplicates are rejected.
ALTER TABLE customers ADD COLUMN phone_key TEXT GENERATED ALWAYS AS (CASE
 WHEN length(replace(replace(replace(replace(replace(replace(replace(replace(replace(COALESCE(phone,''),' ',''),'-',''),'(',''),')',''),'+',''),'.',''),char(9),''),char(10),''),char(13),''))=13 AND substr(replace(replace(replace(replace(replace(replace(replace(replace(replace(COALESCE(phone,''),' ',''),'-',''),'(',''),')',''),'+',''),'.',''),char(9),''),char(10),''),char(13),''),1,4)='0061' THEN '0'||substr(replace(replace(replace(replace(replace(replace(replace(replace(replace(COALESCE(phone,''),' ',''),'-',''),'(',''),')',''),'+',''),'.',''),char(9),''),char(10),''),char(13),''),5)
 WHEN length(replace(replace(replace(replace(replace(replace(replace(replace(replace(COALESCE(phone,''),' ',''),'-',''),'(',''),')',''),'+',''),'.',''),char(9),''),char(10),''),char(13),''))=11 AND substr(replace(replace(replace(replace(replace(replace(replace(replace(replace(COALESCE(phone,''),' ',''),'-',''),'(',''),')',''),'+',''),'.',''),char(9),''),char(10),''),char(13),''),1,2)='61' THEN '0'||substr(replace(replace(replace(replace(replace(replace(replace(replace(replace(COALESCE(phone,''),' ',''),'-',''),'(',''),')',''),'+',''),'.',''),char(9),''),char(10),''),char(13),''),3)
 ELSE replace(replace(replace(replace(replace(replace(replace(replace(replace(COALESCE(phone,''),' ',''),'-',''),'(',''),')',''),'+',''),'.',''),char(9),''),char(10),''),char(13),'') END) VIRTUAL;
CREATE INDEX customers_phone_key ON customers(phone_key);
CREATE TRIGGER customers_phone_insert BEFORE INSERT ON customers
 WHEN NEW.phone_key!='' AND EXISTS(SELECT 1 FROM customers WHERE phone_key=NEW.phone_key AND id!=NEW.id)
 BEGIN SELECT RAISE(ABORT,'CUSTOMER_DUPLICATE_PHONE'); END;
CREATE TRIGGER customers_phone_update BEFORE UPDATE OF phone ON customers
 WHEN NEW.phone_key!=OLD.phone_key AND NEW.phone_key!='' AND EXISTS(SELECT 1 FROM customers WHERE phone_key=NEW.phone_key AND id!=NEW.id)
 BEGIN SELECT RAISE(ABORT,'CUSTOMER_DUPLICATE_PHONE'); END;
