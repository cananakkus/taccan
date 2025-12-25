#       Assumptions:
# 1) We will always assume a player belongs to a team, it might be spectators, blue or red

class Player:
    def __init__(self, id : int, name : str, team, role : str):
        self.id = id
        self.name = name
        self.team = team
        self.role = role
    
    def make_spymaster(self):
        self.role = "spymaster"
        if self.team.spymaster != self:
            self.team.spymaster = self
    
    def make_spy(self):
        self.role = "spy"
        if self.team.spymaster == self:
            self.team.spymaster = None
    
    def is_spymaster(self):
        return self.role == "spymaster" and self.team.spymaster == self
    
    def is_spy(self):
        return self.role == "spy" and self.team.spymaster != self
    
    def is_spectator(self):
        return self.team.id == 0

    def is_blue_team(self):
        return self.team.id == 1
    
    def is_red_team(self):
        return self.team.id == 2
    