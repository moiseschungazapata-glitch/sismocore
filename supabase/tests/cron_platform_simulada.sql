-- Test-only simulation: no network, real extensions, credentials or scheduled tasks.
create schema cron;
create schema net;
create schema vault;
create schema if not exists extensions;
create table cron.job(jobid bigint generated always as identity primary key,jobname text unique,schedule text,command text,active boolean default true);
create table cron.job_run_details(jobid bigint,start_time timestamptz,status text,return_message text);
create function cron.schedule(job_name text,job_schedule text,job_command text) returns bigint language sql as $$
 insert into cron.job(jobname,schedule,command) values($1,$2,$3)
 on conflict(jobname) do update set schedule=$2,command=$3 returning jobid;
$$;
create function cron.alter_job(job_id bigint,active boolean default null) returns void language sql as $$
 update cron.job set active=$2 where jobid=$1;
$$;
create table net.http_request_queue(id bigint generated always as identity primary key,headers jsonb,timeout_milliseconds integer);
create table net._http_response(id bigint,status_code integer,timed_out boolean);
create function net.http_post(url text,body jsonb default '{}'::jsonb,headers jsonb default '{}'::jsonb,timeout_milliseconds integer default 2000)
returns bigint language sql as $$
 insert into net.http_request_queue(headers,timeout_milliseconds) values($3,$4) returning id;
$$;
create table vault.secrets(id uuid default gen_random_uuid(),name text,secret text);
create view vault.decrypted_secrets as select id,name,secret as decrypted_secret from vault.secrets;
