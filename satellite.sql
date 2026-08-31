--
-- PostgreSQL database dump
--

\restrict Lwu1t6pECN7wJrGZt0m8PBRuK57hbaxT8MPJFbQdeTb6qZgJHi6VAjdutzVMWy0

-- Dumped from database version 18.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: apps; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.apps (
    id text NOT NULL,
    name text NOT NULL,
    path text NOT NULL,
    port integer NOT NULL,
    package_manager text DEFAULT 'npm'::text NOT NULL,
    db_type text,
    db_name text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.apps OWNER TO postgres;

--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id integer NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.users_id_seq OWNER TO postgres;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Data for Name: apps; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.apps (id, name, path, port, package_manager, db_type, db_name, created_at) FROM stdin;
capacitacion-rh	Capacitacion RH	C:\\Users\\JOHERNANDEZ\\Documents\\codigos\\capacitacion-rh	4552	pnpm	PostgreSQL	capacitacion_rh	2026-08-28 11:24:39.104414-06
sistema-tickets	Sistema Tickets	C:\\Users\\JOHERNANDEZ\\Documents\\codigos\\sistema-tickets	4559	pnpm	PostgreSQL	ticketing_safedemo	2026-08-28 11:24:39.106969-06
auditoria-app	Auditoria App	C:\\Users\\JOHERNANDEZ\\Documents\\codigos\\auditoria_app	4561	pnpm	PostgreSQL	auditorias_db	2026-08-28 11:24:39.107744-06
kpi-dashboard	KPI Dashboard	C:\\Users\\JOHERNANDEZ\\Documents\\codigos\\db_data\\kpi-dashboard	4554	npm	PostgreSQL	scorecard	2026-08-28 11:24:39.105449-06
gestion-comedor	Gestión de Comedor	C:\\\\Users\\\\JOHERNANDEZ\\\\Documents\\\\codigos\\\\gestion-comedor	4551	npm	SQLite	data.db	2026-08-28 11:24:39.101894-06
sistema-entrada	Sistema Entrada	C:\\Users\\JOHERNANDEZ\\Documents\\codigos\\sistema-entrada	4555	npm	PostgreSQL	sistema-entrada	2026-08-28 11:24:39.106137-06
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (id, email, password_hash, created_at) FROM stdin;
1	jose.hernandez@safe-demo.con	$2b$12$SU7LmudP9/dYWHijNnXx4.D6w2jZqLUoXMQJ83633GJe.ejw4Wgsu	2026-08-28 11:20:45.441595-06
2	jose.hernandez@safe-demo.com	$2b$12$SU7LmudP9/dYWHijNnXx4.D6w2jZqLUoXMQJ83633GJe.ejw4Wgsu	2026-08-28 11:35:24.906442-06
\.


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.users_id_seq', 2, true);


--
-- Name: apps apps_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.apps
    ADD CONSTRAINT apps_pkey PRIMARY KEY (id);


--
-- Name: apps apps_port_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.apps
    ADD CONSTRAINT apps_port_key UNIQUE (port);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- PostgreSQL database dump complete
--

\unrestrict Lwu1t6pECN7wJrGZt0m8PBRuK57hbaxT8MPJFbQdeTb6qZgJHi6VAjdutzVMWy0

