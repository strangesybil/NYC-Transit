from django.conf import settings
from django.db import models
from django.utils import timezone


class ServiceAlert(models.Model):
    """One live service alert published by the MTA (delay, reroute, planned work...)."""

    alert_id = models.CharField(max_length=200, unique=True)  # the MTA's own id
    alert_type = models.CharField(max_length=100, blank=True)  # e.g. "Delays"
    header = models.TextField()  # short headline
    description = models.TextField(blank=True)  # longer explanation
    routes = models.CharField(max_length=200, blank=True)  # affected lines, e.g. "A,C,E"
    start_time = models.DateTimeField(null=True, blank=True)
    end_time = models.DateTimeField(null=True, blank=True)
    fetched_at = models.DateTimeField(auto_now=True)  # when WE last saved it

    class Meta:
        ordering = ["-start_time", "alert_id"]

    def __str__(self):
        return f"[{self.routes}] {self.header[:60]}"

    @property
    def route_list(self):
        return [r for r in self.routes.split(",") if r]

    def is_expired(self, now=None):
        now = now or timezone.now()
        return bool(self.end_time and self.end_time < now)

    def is_upcoming(self, now=None):
        now = now or timezone.now()
        return bool(self.start_time and self.start_time > now)

    def is_active(self, now=None):
        """True only while the alert is happening right now."""
        now = now or timezone.now()
        return not self.is_expired(now) and not self.is_upcoming(now)


class Favorite(models.Model):
    """A route or station a signed-in user saved (used by the Favorites feature)."""

    ROUTE = "route"
    STATION = "station"
    KIND_CHOICES = [(ROUTE, "Route"), (STATION, "Station")]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="favorites"
    )
    kind = models.CharField(max_length=10, choices=KIND_CHOICES)
    name = models.CharField(max_length=100)  # "A" or "Times Sq-42 St"
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("user", "kind", "name")

    def __str__(self):
        return f"{self.user} - {self.kind}: {self.name}"
