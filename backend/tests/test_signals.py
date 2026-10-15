from engine import SignalController, density, confirmed_emergencies, DEFAULTS, ROADS

def test_density_thresholds():
    assert [density(n, DEFAULTS) for n in (0, 10, 11, 20, 21, 35, 36)] == ["LOW","LOW","MEDIUM","MEDIUM","HIGH","HIGH","CRITICAL"]

def test_emergency_first_come_first_served_and_safe_transitions():
    roads = {r: {"count": 0, "total_unique": 0} for r in ROADS}
    controller = SignalController()
    controller.started = 0
    emergencies = [{"road":"North"},{"road":"East"}]
    first = controller.tick(roads, emergencies, DEFAULTS, 3)
    assert first["road"] == "North" and first["phase"] == "GREEN"
    emergencies.pop(0)
    assert controller.tick(roads, emergencies, DEFAULTS, 14)["phase"] == "YELLOW"
    assert controller.tick(roads, emergencies, DEFAULTS, 18)["phase"] == "ALL_RED"
    assert controller.tick(roads, emergencies, DEFAULTS, 21)["road"] == "East"

def test_emergency_requires_three_consecutive_tracked_frames():
    seen = {}
    ambulance = [{"id": 7, "class_name": "ambulance"}]
    ordinary = [{"id": 8, "class_name": "car"}]
    assert confirmed_emergencies("North", ordinary, seen)[1] == []
    assert confirmed_emergencies("North", ambulance, seen)[1] == []
    assert confirmed_emergencies("North", [], seen)[1] == []
    assert confirmed_emergencies("North", ambulance, seen)[1] == []
    assert confirmed_emergencies("North", ambulance, seen)[1] == []
    assert confirmed_emergencies("North", ambulance, seen)[1] == [{"road":"North","vehicle":"ambulance","id":7}]
    assert confirmed_emergencies("North", ambulance, seen)[1] == []
