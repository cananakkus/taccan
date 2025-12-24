from player import Player

class Team:
    
    def __init__(
        self, id : int, colour : str, 
        cards : list, members : list, 
        spymaster : Player
        ):
        
        self.id = id
        self.colour = colour
        self.cards = cards
        self.members = members
        self.spymaster = spymaster
        
    def print_cards(self):
        for card in self.cards:
            card.print_card()
    
    