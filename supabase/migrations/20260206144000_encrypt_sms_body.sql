-- DB-side SMS body encryption helper (pgcrypto)

create or replace function public.encrypt_sms_body(plaintext text, key text)
returns bytea
language sql
volatile
as $$
  select pgp_sym_encrypt(plaintext, key, 'cipher-algo=aes256, compress-algo=0');
$$;
