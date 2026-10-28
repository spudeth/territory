-- The empty spots where a map can grow: every place with no block that touches a block up, down, left or
-- right (holes included). Growth picks one at random from here instead of scanning the whole map, and keeps
-- it up to date. Filled here for existing maps.
CREATE TABLE map_edges (
  map_id bigint  NOT NULL REFERENCES maps (id),
  x      integer NOT NULL,
  y      integer NOT NULL,
  PRIMARY KEY (map_id, x, y)
);

INSERT INTO map_edges (map_id, x, y)
SELECT DISTINCT c.map_id, n.x, n.y
FROM map_cells c
CROSS JOIN LATERAL (VALUES (c.x + 1, c.y), (c.x - 1, c.y), (c.x, c.y + 1), (c.x, c.y - 1)) AS n (x, y)
WHERE NOT EXISTS (SELECT 1 FROM map_cells e WHERE e.map_id = c.map_id AND e.x = n.x AND e.y = n.y);
