<?php
namespace App\Events;
class PlaybackStarted {
    public $song;
    public function __construct($song) { $this->song = $song; }
}
