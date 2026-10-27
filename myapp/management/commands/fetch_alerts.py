from django.core.management.base import BaseCommand

from myapp.mta import sync_alerts


class Command(BaseCommand):
    help = "Download the latest MTA service alerts and save them to the database."

    def handle(self, *args, **options):
        count = sync_alerts()
        self.stdout.write(self.style.SUCCESS(f"Saved {count} live alerts."))
