from card import Card
from team import Team
from player import Player


class Board:
    
    def __init__(self, words=None):
        self.set_words(words)
        self.cards = []
        self.neutral_cards = []
        self.blue_cards = []
        self.red_cards = []
        self.black_cards = []
        self.create_board(self.words)
        self.card_groups = [self.neutral_cards, self.blue_cards, self.red_cards, self.black_cards]
        
    def create_board(self, words):
        for i in range(len(words)):
            word = words[i]
            self.create_card(word, None, False)
    
    def create_card(self, word : str, team : Team, is_revealed : bool):
        new_card = Card(word, team, is_revealed)
        self.cards.append(new_card)
    
    def reveal_card(self, card_to_reveal):
        for card in self.cards:
            if card == card_to_reveal:
                card.reveal()
    
    def print_cards(self):
        for card in self.cards:
            card.print_card()
    
    def get_card(self, index):
        return self.cards[index]

    def get_card_group(self, index : int):
        return self.card_groups[index]
    
    def set_words(self, words : list):
        if words == None or len(words) != 25:
            self.words = ["Kedi", "Uçak", "Elma", "Deniz", "Bilgisayar",
                            "Saat", "Köprü", "Güneş", "Kitap", "Telefon",
                            "Masa", "Kalem", "Ay", "Bulut", "Araba",
                            "Yıldız", "Dağ", "Kahve", "Müzik", "Ağaç",
                            "Kapı", "Film", "Oyun", "Kamera", "Bardak"]
        else:
            self.words = words
