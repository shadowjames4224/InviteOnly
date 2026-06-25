-- Seed data for Decentralized Review Ecosystem (Clean Seed)

-- 1. Seed Profiles (Only Root Admin Moderator)
INSERT INTO public.profiles (id, username, reputation_score, invited_by, is_active) VALUES
  ('00000000-0000-0000-0000-000000000001', 'root_moderator', 1.0000, NULL, TRUE);

-- 2. Seed Taxonomic Nodes (Standard taxonomy tree)
-- Insert root node first
INSERT INTO public.nodes (id, parent_id, name, slug, node_type, path) VALUES
  (1, NULL, 'Earth', 'earth', 'planet', '1');

-- Parent-child relationships (let trigger generate paths automatically)
INSERT INTO public.nodes (id, parent_id, name, slug, node_type) VALUES
  (2, 1, 'United States', 'united_states', 'country'),
  (3, 2, 'Texas', 'texas', 'state'),
  (4, 3, 'Austin', 'austin', 'city'),
  (5, 4, 'Coffee Shops', 'coffee_shops', 'category'),
  (6, 5, 'Epoch Coffee', 'epoch_coffee', 'merchant'),
  (7, 5, 'Radio Coffee & Beer', 'radio_coffee_beer', 'merchant'),
  (8, 6, 'Cold Brew Coffee', 'cold_brew_coffee', 'item');

-- 3. Seed Tags (Standard system tags)
INSERT INTO public.tags (id, name) VALUES
  (1, 'third wave coffee shop'),
  (2, 'fishing'),
  (3, 'EDC gear'),
  (4, 'outdoor recreation');
