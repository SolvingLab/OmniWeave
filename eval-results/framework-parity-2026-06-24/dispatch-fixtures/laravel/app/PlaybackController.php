<?php
namespace App\Http;
use App\Events\PlaybackStarted;
class PlaybackController {
    public function play($song) {
        event(new PlaybackStarted($song));
    }
}
