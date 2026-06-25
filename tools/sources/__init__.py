"""Course-data source adapters.

Each adapter normalizes a provider into the shapes the baker consumes. Today
only the scorecard layer is wired (par / yards / stroke-index); geometry still
comes from OSM in tools/fetch_course.py. Future adapters (golfbert geometry,
igolf/golfintelligence premium break+elevation) plug in behind the same idea:
free sources are default-on, paid sources are key-gated and opt-in.
"""
