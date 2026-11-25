from django.urls import path

from . import favorites, views, stations

urlpatterns = [
    path("lines/", views.dashboard, {"page": "lines"}, name="line-status"),
    path("stations/", views.dashboard, {"page": "stations"}, name="station-status"),
    path("api/stations/", stations.stations_api, name="stations"),
    path("", views.dashboard, name="dashboard"),
    path("api/alerts/", views.alerts_api, name="alerts"),
    path("api/status/", views.status_api, name="status"),
    path("api/elevators/", views.elevators_api, name="elevators"),
    path("api/favorites/", favorites.favorites_api, name="favorites"),
    path("api/favorites/<int:favorite_id>/", favorites.favorite_detail_api, name="favorite-detail"),
]
