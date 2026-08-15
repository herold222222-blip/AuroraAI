/* saved constraints - will be dropped and recreated */
-- users_pkey ON public.users
-- PRIMARY KEY (id)

-- orders_user_id_fkey ON public.orders
-- FOREIGN KEY (user_id) REFERENCES users(id)

-- orders_pkey ON public.orders
-- PRIMARY KEY (id)

-- sponsorships_target_user_id_fkey ON public.sponsorships
-- FOREIGN KEY (target_user_id) REFERENCES users(id)

-- sponsorships_sponsor_id_fkey ON public.sponsorships
-- FOREIGN KEY (sponsor_id) REFERENCES users(id)

-- sponsorships_pkey ON public.sponsorships
-- PRIMARY KEY (id)

-- projects_owner_id_fkey ON public.projects
-- FOREIGN KEY (owner_id) REFERENCES users(id)

-- projects_pkey ON public.projects
-- PRIMARY KEY (id)

