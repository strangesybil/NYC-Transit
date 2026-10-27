from django.urls import path

from . import views

urlpatterns = [
    path("api/alerts/", views.alerts_api, name="alerts"),
    path("api/status/", views.status_api, name="status"),
]
