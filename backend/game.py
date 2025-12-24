import random

from card import Card
from board import Board
from team import Team
from player import Player

PLAYER_NAMES = ["Soldier", "Autarkia", "Hako", "Arch"]

class Game:
    
    def __init__(self):
        
        self.board = Board()
        self.teams = []
        self.players = []
        self.blue_players = []
        self.red_players = []
        
        for i in range(4):
            name = PLAYER_NAMES[i]
            team = None
            role = "spymaster" if (i % 2 == 0) else "spy"
            new_player = Player(name, team, role)
            self.players.append(new_player)
            if i == 0 or i == 1:
                self.red_players.append(new_player)
            else:
                self.blue_players.append(new_player)
        
        # blue team has 9 cards, red team has 8 cards
        self.blue_cards = []
        self.red_cards = []
        # 7 cards are neutral, 1 card is black
        self.neutral_cards = []
        self.black_card = self.board.get_card(24)
        
        # 0-8: blue card
        # 9-17: red cards
        # 18-24: neutral cards
        # 25: black card
        for i in range(9):
            self.blue_cards.append(self.board.get_card(i))
        
        for i in range(9, 18):
            self.red_cards.append(self.board.get_card(i))
        
        for i in range(18, 24):
            self.neutral_cards.append(self.board.get_card(i))
        
        self.blue_spymaster = self.blue_players[0]
        self.red_spymaster = self.red_players[0]
        
        self.blue_team = self.create_team(0, "blue", self.blue_cards, self.blue_players, self.blue_spymaster)
        self.red_team = self.create_team(1, "red", self.red_cards, self.red_players, self.red_spymaster)
        
        for player in self.red_players:
            player.team = self.red_team
            
        for player in self.blue_players:
            player.team = self.blue_team
    
    def create_team(self, id, colour, card_list, player_list, spymaster):
        team = Team(id, colour, card_list, player_list, spymaster)
        self.teams.append(team)
        return team
        