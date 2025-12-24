class Card:
    
    def __init__(self, word, team, is_revealed=False):
        self.word = word
        self.team = team
        self.is_revealed = is_revealed
        self.revealed_by = None
    
    def reveal(self, player):
        self.is_revealed = True
        self.revealed_by = player
    
    def hide(self):
        self.is_revealed = False
    
    def print_card(self):
        print(f"{self.word} | {self.team} | {self.is_revealed}")
    