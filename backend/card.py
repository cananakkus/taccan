class Card:
    
    def __init__(self, word, team, is_revealed=False):
        self.text = word
        self.team = team
        self.is_revealed = is_revealed
    
    
    def reveal(self):
        self.is_revealed = True
    
    def hide(self):
        self.is_revealed = False
    
    def print_card(self):
        print(f"{self.word} | {self.team} | {self.is_revealed}")
    