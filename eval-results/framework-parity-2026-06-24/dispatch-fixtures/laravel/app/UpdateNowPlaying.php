<?php
namespace App\Listeners;
use App\Events\PlaybackStarted;
class UpdateNowPlaying {
    public function handle(PlaybackStarted $event) {
        return $event->song;
    }
}
