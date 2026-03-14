// A test story for Ink Language Pro
// This exercises all major Ink features

VAR player_name = "Player"
VAR health = 100
VAR has_key = false
CONST MAX_HEALTH = 100
LIST Inventory = sword, shield, (potion)

-> start

=== start ===
Welcome, {player_name}! Your adventure begins here.
Your health is {health}/{MAX_HEALTH}. # intro_tag

* [Enter the dark forest] -> dark_forest
* [Visit the village] -> village
* {has_key} [Open the locked gate] -> final_area

=== dark_forest ===
The trees close in around you. It's eerily quiet.
~ health = health - 10

* [Search for treasure]
  You find a rusty key! # discovery
  ~ has_key = true
  -> dark_forest_clearing
* [Turn back]
  You retreat to safety.
  -> start

= clearing
A shaft of sunlight breaks through the canopy.
- (decision_point)
* [Rest here]
  ~ health = health + 20
  You feel refreshed.
  -> start
* [Press deeper]
  -> deep_woods

=== dark_forest_clearing ===
The clearing is peaceful. Birds sing overhead.
<- ambient_sounds
-> start

=== deep_woods ===
You've gone too far. The path behind you has vanished.

{ health < 50:
  You feel weak and tired.
- else:
  You feel strong enough to continue.
}

* [Use a potion] {Inventory ? potion}
  ~ health = health + 50
  ~ Inventory -= potion
  The potion restores your energy!
  -> start
* [Call for help]
  {~Nobody answers.|A distant echo replies.|Silence.|You hear footsteps!}
  -> start

=== village ===
The village is bustling with activity.

* [Talk to the shopkeeper] -> shopkeeper
* [Visit the inn] -> inn
* [Leave] -> start

= shopkeeper
"Welcome! What can I do for you?"
* ["I need supplies"]
  "That'll be 10 gold."
  -> village
* ["Just looking"]
  -> village

= inn
The inn is warm and inviting.
~ health = MAX_HEALTH
Your health is restored!
-> village

=== ambient_sounds ===
~ temp sound = RANDOM(1, 3)
{sound:
- 1: Birds chirp softly.
- 2: Leaves rustle in the wind.
- 3: A stream babbles nearby.
}
-> DONE

=== function heal(ref hp, amount) ===
~ hp = hp + amount
{ hp > MAX_HEALTH:
  ~ hp = MAX_HEALTH
}

=== final_area ===
You unlock the gate with the rusty key.
Beyond lies your destiny...
-> END
