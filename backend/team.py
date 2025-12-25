from player import Player

class Team:
    
    def __init__(
        self, id : int, colour : str, 
        cards : list, members : list, 
        spymaster : Player, board
        ):
        
        self.id = id
        self.colour = colour
        self.cards = board.get_card_group(self.id)
        self.members = members
        self.spymaster = spymaster
        self.board = board
            
    def add_player(self, player : Player):
        self.members.append(player)
    
    def remove_player(self, player : Player):
        self.members.remove(player)
    
    def make_spymaster(self, index : int):
        player = self.get_player_at(index)
        if player == None:
            return
        if self.spymaster != None:
            self.spymaster.make_spy()
        player.make_spymaster()
    
    def get_player_at(self, index : int):
        if (index + 1 > len(self.members)):
            return None
        return self.members[index]
    
    def print_cards(self):
        for card in self.cards:
            card.print_card()
    